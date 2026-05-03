import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { TenantRole } from '@capiro/shared';
import type { OrganizationMembershipRole, User } from '@clerk/backend';
import { ClerkService } from './clerk.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type ProvisionableRole = Extract<TenantRole, 'capiro_admin' | 'user_admin' | 'standard_user'>;

interface ProvisionOrganizationMemberInput {
  tenantId: string;
  organizationId: string;
  email: string;
  role: ProvisionableRole;
  actorUserId?: string;
  actorClerkUserId?: string;
}

export interface ProvisionOrganizationMemberResult {
  clerkUserId: string;
  localUserId: string;
  membershipId: string;
  userCreated: boolean;
  membershipCreated: boolean;
  membershipRoleUpdated: boolean;
}

/**
 * Provisions identity in Clerk first, then mirrors the successful Clerk state
 * into Capiro. The admin UI should never create local-only placeholder users.
 */
@Injectable()
export class ClerkProvisioningService {
  private readonly logger = new Logger(ClerkProvisioningService.name);

  constructor(
    private readonly clerk: ClerkService,
    private readonly prisma: PrismaService,
  ) {}

  async provisionOrganizationMember(
    input: ProvisionOrganizationMemberInput,
  ): Promise<ProvisionOrganizationMemberResult> {
    const email = normalizeEmail(input.email);
    const clerkRole = toClerkOrganizationRole(input.role);
    const userResult = await this.ensureClerkUser(email);
    const membershipResult = await this.ensureOrganizationMembership(
      input.organizationId,
      userResult.user.id,
      clerkRole,
    );

    await this.revokeStalePendingInvitation(input.organizationId, email, input.actorClerkUserId);

    const synced = await this.syncLocalMembership({
      tenantId: input.tenantId,
      user: userResult.user,
      role: input.role,
      actorUserId: input.actorUserId,
    });

    return {
      clerkUserId: userResult.user.id,
      localUserId: synced.userId,
      membershipId: synced.membershipId,
      userCreated: userResult.created,
      membershipCreated: membershipResult.created,
      membershipRoleUpdated: membershipResult.roleUpdated,
    };
  }

  private async ensureClerkUser(email: string): Promise<{ user: User; created: boolean }> {
    const existing = await this.findClerkUserByEmail(email);
    if (existing) return { user: existing, created: false };

    try {
      const created = await this.clerk.backend.users.createUser({
        emailAddress: [email],
        skipPasswordRequirement: true,
        publicMetadata: { capiro_provisioned: true },
      });
      return { user: created, created: true };
    } catch (err) {
      // Covers a concurrent admin action that created the Clerk user after our
      // first lookup. Other Clerk validation errors are allowed to surface.
      const raced = await this.findClerkUserByEmail(email);
      if (raced) return { user: raced, created: false };
      throw err;
    }
  }

  private async findClerkUserByEmail(email: string): Promise<User | undefined> {
    const users = await this.clerk.backend.users.getUserList({
      emailAddress: [email],
      limit: 10,
    });
    return users.data.find((user) => userEmail(user).toLowerCase() === email);
  }

  private async ensureOrganizationMembership(
    organizationId: string,
    userId: string,
    role: OrganizationMembershipRole,
  ): Promise<{ created: boolean; roleUpdated: boolean }> {
    const existing = await this.findOrganizationMembership(organizationId, userId);
    if (existing) {
      if (existing.role !== role) {
        await this.clerk.backend.organizations.updateOrganizationMembership({
          organizationId,
          userId,
          role,
        });
        return { created: false, roleUpdated: true };
      }
      return { created: false, roleUpdated: false };
    }

    try {
      await this.clerk.backend.organizations.createOrganizationMembership({
        organizationId,
        userId,
        role,
      });
      return { created: true, roleUpdated: false };
    } catch (err) {
      // Same race guard as user creation: if Clerk now has the membership,
      // converge it to the requested role and keep the operation idempotent.
      const raced = await this.findOrganizationMembership(organizationId, userId);
      if (!raced) throw err;
      if (raced.role !== role) {
        await this.clerk.backend.organizations.updateOrganizationMembership({
          organizationId,
          userId,
          role,
        });
        return { created: false, roleUpdated: true };
      }
      return { created: false, roleUpdated: false };
    }
  }

  private async findOrganizationMembership(organizationId: string, userId: string) {
    const memberships = await this.clerk.backend.organizations.getOrganizationMembershipList({
      organizationId,
      userId: [userId],
      limit: 10,
    });
    return (
      memberships.data.find((membership) => membership.publicUserData?.userId === userId) ??
      memberships.data[0]
    );
  }

  private async revokeStalePendingInvitation(
    organizationId: string,
    email: string,
    requestingUserId?: string,
  ): Promise<void> {
    const pending = await this.clerk.backend.organizations.getOrganizationInvitationList({
      organizationId,
      status: ['pending'],
      limit: 100,
    });
    const stale = pending.data.find((inv) => inv.emailAddress.toLowerCase() === email);
    if (!stale) return;

    await this.clerk.backend.organizations
      .revokeOrganizationInvitation({
        organizationId,
        invitationId: stale.id,
        requestingUserId,
      })
      .catch((err) => {
        this.logger.warn(
          `Unable to revoke stale Clerk invitation ${stale.id}: ${errorMessage(err)}`,
        );
      });
  }

  private async syncLocalMembership(input: {
    tenantId: string;
    user: User;
    role: ProvisionableRole;
    actorUserId?: string;
  }): Promise<{ userId: string; membershipId: string }> {
    const email = userEmail(input.user);
    if (!email) {
      throw new BadRequestException(`Clerk user ${input.user.id} has no email address`);
    }

    return this.prisma.withSystem(async (tx) => {
      const userData = {
        clerkUserId: input.user.id,
        email,
        firstName: input.user.firstName,
        lastName: input.user.lastName,
      };
      const existingUser =
        (await tx.user.findUnique({ where: { clerkUserId: input.user.id } })) ??
        (await tx.user.findUnique({ where: { email } }));
      const user = existingUser
        ? await tx.user.update({ where: { id: existingUser.id }, data: userData })
        : await tx.user.create({ data: userData });

      const existingMembership = await tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId: input.tenantId, userId: user.id } },
      });
      const joinedAt = existingMembership?.joinedAt ?? new Date();
      const membership = existingMembership
        ? await tx.tenantMembership.update({
            where: { id: existingMembership.id },
            data: {
              role: input.role,
              status: 'active',
              joinedAt,
              invitedBy: input.actorUserId ?? existingMembership.invitedBy,
            },
          })
        : await tx.tenantMembership.create({
            data: {
              tenantId: input.tenantId,
              userId: user.id,
              role: input.role,
              status: 'active',
              joinedAt,
              invitedBy: input.actorUserId,
            },
          });

      return { userId: user.id, membershipId: membership.id };
    });
  }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    throw new BadRequestException('Email is required');
  }
  return normalized;
}

function toClerkOrganizationRole(role: ProvisionableRole): OrganizationMembershipRole {
  return (role === 'standard_user' ? 'org:member' : 'org:admin') as OrganizationMembershipRole;
}

function userEmail(user: User): string {
  return user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? '';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
