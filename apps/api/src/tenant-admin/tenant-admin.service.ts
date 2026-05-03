import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { ClerkProvisioningService } from '../auth/clerk-provisioning.service.js';
import { ClerkService } from '../auth/clerk.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface InviteTeamMemberInput {
  email: string;
  role: 'user_admin' | 'standard_user';
  redirectUrl?: string;
}

interface UpdateBrandingInput {
  name?: string;
  // Logo upload itself is a separate presigned-URL flow — this only updates
  // the row metadata once the client has finished uploading.
  logoS3Key?: string;
  logoContentType?: string;
}

/**
 * Per-tenant admin operations. Caller must be `user_admin` (own tenant) or
 * `capiro_admin` (any tenant). Methods receive the TenantContext so RLS
 * scopes everything to the right tenant.
 */
@Injectable()
export class TenantAdminService {
  private readonly logger = new Logger(TenantAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clerk: ClerkService,
    private readonly provisioning: ClerkProvisioningService,
  ) {}

  async listTeam(ctx: TenantContext) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const memberships = await tx.tenantMembership.findMany({
        where: { tenantId: ctx.tenantId },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true, lastSeenAt: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      return memberships.map((m) => ({
        membershipId: m.id,
        userId: m.user.id,
        email: m.user.email,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt,
        lastSeenAt: m.user.lastSeenAt,
      }));
    });
  }

  async listPendingInvitations(ctx: TenantContext) {
    const tenant = await this.prisma.withSystem(async (tx) =>
      tx.tenant.findUnique({ where: { id: ctx.tenantId } }),
    );
    if (!tenant?.clerkOrgId) return [];
    const pending = await this.clerk.backend.organizations.getOrganizationInvitationList({
      organizationId: tenant.clerkOrgId,
      status: ['pending'],
    });
    return pending.data.map((inv) => ({
      id: inv.id,
      email: inv.emailAddress,
      role: inv.role.toLowerCase().includes('admin') ? 'user_admin' : 'standard_user',
      createdAt: new Date(inv.createdAt).toISOString(),
      expiresAt: inv.expiresAt ? new Date(inv.expiresAt).toISOString() : null,
    }));
  }

  async inviteTeamMember(ctx: TenantContext, input: InviteTeamMemberInput) {
    const tenant = await this.prisma.withSystem(async (tx) =>
      tx.tenant.findUnique({ where: { id: ctx.tenantId } }),
    );
    if (!tenant?.clerkOrgId) {
      throw new BadRequestException('Tenant has no Clerk organization linked');
    }
    const member = await this.provisioning.provisionOrganizationMember({
      tenantId: ctx.tenantId,
      organizationId: tenant.clerkOrgId,
      email: input.email,
      role: input.role,
      actorUserId: ctx.userId,
      actorClerkUserId: ctx.clerkUserId,
    });
    return { member, status: member.userCreated ? 'created' : 'updated' };
  }

  async resendInvitation(ctx: TenantContext, invitationId: string) {
    const tenant = await this.prisma.withSystem(async (tx) =>
      tx.tenant.findUnique({ where: { id: ctx.tenantId } }),
    );
    if (!tenant?.clerkOrgId) throw new BadRequestException('Tenant has no Clerk organization');
    const list = await this.clerk.backend.organizations.getOrganizationInvitationList({
      organizationId: tenant.clerkOrgId,
      status: ['pending'],
    });
    const found = list.data.find((inv) => inv.id === invitationId);
    if (!found) throw new NotFoundException('Invitation not found in this tenant');
    await this.clerk.backend.organizations.revokeOrganizationInvitation({
      organizationId: tenant.clerkOrgId,
      invitationId: found.id,
      requestingUserId: tenant.clerkOrgId,
    });
    const fresh = await this.clerk.backend.organizations.createOrganizationInvitation({
      organizationId: tenant.clerkOrgId,
      emailAddress: found.emailAddress,
      role: found.role,
      redirectUrl: 'https://app.capiro.ai/sign-in',
    });
    return { invitationId: fresh.id };
  }

  async removeMember(ctx: TenantContext, userId: string) {
    if (userId === ctx.userId) {
      throw new BadRequestException('Cannot remove yourself');
    }
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const membership = await tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId: ctx.tenantId, userId } },
        include: { user: true, tenant: true },
      });
      if (!membership) throw new NotFoundException('Membership not found');
      await tx.tenantMembership.update({
        where: { id: membership.id },
        data: { status: 'removed' },
      });
      if (membership.tenant.clerkOrgId) {
        await this.clerk.backend.organizations
          .deleteOrganizationMembership({
            organizationId: membership.tenant.clerkOrgId,
            userId: membership.user.clerkUserId,
          })
          .catch((err) => {
            this.logger.warn(`Clerk delete-membership: ${(err as Error).message}`);
          });
      }
      return { ok: true };
    });
  }

  async updateBranding(ctx: TenantContext, input: UpdateBrandingInput) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.logoS3Key !== undefined) {
        data.logoS3Key = input.logoS3Key;
        data.logoContentType = input.logoContentType ?? null;
        data.logoUploadedAt = new Date();
      }
      const updated = await tx.tenant.update({
        where: { id: ctx.tenantId },
        data,
      });
      // Mirror display name to Clerk (best-effort).
      if (input.name && updated.clerkOrgId) {
        await this.clerk.backend.organizations
          .updateOrganization(updated.clerkOrgId, { name: input.name })
          .catch(() => undefined);
      }
      return updated;
    });
  }

  async getBilling(ctx: TenantContext) {
    // Billing surface is a stub until Stripe / Metronome lands. Returning a
    // structured placeholder so the UI can render a meaningful "coming soon"
    // card rather than a generic 404.
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: ctx.tenantId } });
      return {
        placeholder: true,
        message: 'Billing will be wired through Clerk + Stripe in a future release.',
        plan: tenant?.plan ?? 'unspecified',
      };
    });
  }
}
