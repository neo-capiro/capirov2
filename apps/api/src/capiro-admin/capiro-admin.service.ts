import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClerkService } from '../auth/clerk.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface CreateTenantInput {
  slug: string;
  name: string;
  adminEmail: string;
  redirectUrl?: string;
}

/**
 * Cross-tenant operations performed by Capiro staff (capiro_admin role).
 * Every method runs through `prisma.withSystem` (RLS bypass) because the
 * caller is intentionally operating outside any single tenant's scope.
 */
@Injectable()
export class CapiroAdminService {
  private readonly logger = new Logger(CapiroAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clerk: ClerkService,
  ) {}

  async listTenants() {
    return this.prisma.withSystem(async (tx) => {
      return tx.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { memberships: true, clients: true } } },
      });
    });
  }

  async getTenant(tenantId: string) {
    return this.prisma.withSystem(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        include: {
          memberships: {
            include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!tenant) throw new NotFoundException('Tenant not found');
      return tenant;
    });
  }

  async createTenantWithFirstAdmin(input: CreateTenantInput) {
    const slug = input.slug.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
      throw new BadRequestException(
        'Slug must be lowercase, 2-63 chars, [a-z0-9-], not starting with a hyphen',
      );
    }

    // Step 1 — Clerk org (no createdBy; first member is the invited admin).
    const existingList = await this.clerk.backend.organizations.getOrganizationList({
      query: slug,
      limit: 50,
    });
    let org = existingList.data.find((o) => o.slug === slug);
    if (!org) {
      org = await this.clerk.backend.organizations.createOrganization({
        name: input.name,
        slug,
      });
    }

    // Step 2 — DB tenant + Clerk metadata.
    const tenant = await this.prisma.withSystem(async (tx) => {
      const t = await tx.tenant.upsert({
        where: { slug },
        create: { slug, name: input.name, status: 'active', clerkOrgId: org!.id },
        update: { name: input.name, status: 'active', clerkOrgId: org!.id },
      });
      return t;
    });
    await this.clerk.backend.organizations.updateOrganizationMetadata(org.id, {
      publicMetadata: { capiro_tenant_id: tenant.id, capiro_tenant_slug: slug },
    });

    // Step 3 — invitation. Skip if a pending invitation for this email exists.
    const pending = await this.clerk.backend.organizations.getOrganizationInvitationList({
      organizationId: org.id,
      status: ['pending'],
    });
    let invitationId: string | undefined = pending.data.find(
      (inv) => inv.emailAddress.toLowerCase() === input.adminEmail.toLowerCase(),
    )?.id;
    if (!invitationId) {
      const inv = await this.clerk.backend.organizations.createOrganizationInvitation({
        organizationId: org.id,
        emailAddress: input.adminEmail,
        role: 'org:admin',
        redirectUrl: input.redirectUrl ?? 'https://app.capiro.ai/sign-in',
      });
      invitationId = inv.id;
    }

    return { tenant, invitationId, clerkOrgId: org.id };
  }

  async resendAdminInvitation(tenantId: string, email: string, redirectUrl?: string) {
    const tenant = await this.prisma.withSystem(async (tx) => {
      const t = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!t) throw new NotFoundException('Tenant not found');
      if (!t.clerkOrgId) {
        throw new BadRequestException('Tenant has no Clerk organization linked');
      }
      return t;
    });
    const orgId = tenant.clerkOrgId!;
    const pending = await this.clerk.backend.organizations.getOrganizationInvitationList({
      organizationId: orgId,
      status: ['pending'],
    });
    const existing = pending.data.find(
      (inv) => inv.emailAddress.toLowerCase() === email.toLowerCase(),
    );
    if (existing) {
      await this.clerk.backend.organizations.revokeOrganizationInvitation({
        organizationId: orgId,
        invitationId: existing.id,
        requestingUserId: orgId,
      });
    }
    const inv = await this.clerk.backend.organizations.createOrganizationInvitation({
      organizationId: orgId,
      emailAddress: email,
      role: 'org:admin',
      redirectUrl: redirectUrl ?? 'https://app.capiro.ai/sign-in',
    });
    return { invitationId: inv.id };
  }

  async removeUserFromTenant(tenantId: string, userId: string) {
    return this.prisma.withSystem(async (tx) => {
      const membership = await tx.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        include: { user: true, tenant: true },
      });
      if (!membership) throw new NotFoundException('Membership not found');
      // Mark removed in our DB; mirror to Clerk.
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
            // If Clerk-side membership is already gone, that's fine — our DB
            // is the source of truth for the `removed` state from this point.
            this.logger.warn(`Clerk delete-membership failed: ${(err as Error).message}`);
          });
      }
      return { ok: true };
    });
  }

  /**
   * Start an impersonation session per arch §8.2. Reason required + audit
   * logged. Sessions auto-expire after 60 minutes.
   */
  async startImpersonation(actorUserId: string, tenantId: string, reason: string) {
    const trimmed = reason.trim();
    if (trimmed.length < 10) {
      throw new BadRequestException('Reason must be at least 10 characters');
    }
    return this.prisma.withSystem(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      await tx.impersonationSession.updateMany({
        where: { actorUserId, endedAt: null },
        data: { endedAt: new Date(), endedReason: 'replaced' },
      });
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      const session = await tx.impersonationSession.create({
        data: { actorUserId, tenantId, reason: trimmed, expiresAt },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          actorUserId,
          actorRole: 'capiro_admin',
          action: 'impersonation.start',
          entityType: 'impersonation_session',
          entityId: session.id,
          after: { reason: trimmed, expiresAt: expiresAt.toISOString() },
        },
      });
      return {
        sessionId: session.id,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        expiresAt,
      };
    });
  }

  async endImpersonation(actorUserId: string) {
    return this.prisma.withSystem(async (tx) => {
      const updated = await tx.impersonationSession.updateMany({
        where: { actorUserId, endedAt: null },
        data: { endedAt: new Date(), endedReason: 'manual' },
      });
      return { ended: updated.count };
    });
  }

  async sendPasswordReset(clerkUserId: string) {
    // Clerk's "create sign-in token" can be used as a one-time password reset
    // entry point, but the standard flow is to use the user's email-based
    // forgot-password. We trigger the Backend API's password-reset flow:
    // delete current password and send the user a sign-in link.
    // For MVP we just return the Clerk hosted "forgot password" URL — the
    // user clicks it and resets via the standard email flow. Replace with a
    // direct API call once Clerk's `createPasswordResetTicket` is in our SDK.
    return {
      forgotPasswordUrl: `https://app.capiro.ai/sign-in#/factor-one`,
      note: 'Send the user the sign-in URL above; they use "Forgot password" on the Clerk hosted UI.',
      clerkUserId,
    };
  }
}
