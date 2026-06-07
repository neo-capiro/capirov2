import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TenantContext } from '@capiro/shared';
import { ClerkProvisioningService } from '../auth/clerk-provisioning.service.js';
import { ClerkService } from '../auth/clerk.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AppConfig } from '../config/config.schema.js';

interface CreateTenantInput {
  slug: string;
  name: string;
  adminEmail: string;
  adminFirstName?: string;
  adminLastName?: string;
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
    private readonly provisioning: ClerkProvisioningService,
    private readonly config: ConfigService<AppConfig, true>,
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
            include: {
              user: { select: { id: true, email: true, firstName: true, lastName: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!tenant) throw new NotFoundException('Tenant not found');
      return tenant;
    });
  }

  async createTenantWithFirstAdmin(input: CreateTenantInput, actor?: TenantContext) {
    const slug = input.slug.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
      throw new BadRequestException(
        'Slug must be lowercase, 2-63 chars, [a-z0-9-], not starting with a hyphen',
      );
    }

    const adminEmail = input.adminEmail.trim().toLowerCase();
    const adminFirstName = input.adminFirstName?.trim() || null;
    const adminLastName = input.adminLastName?.trim() || null;

    // Step 1: Clerk org.
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

    // Step 2: DB tenant + Clerk metadata.
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

    // Step 3: INVITE the first admin via Clerk's organization invitation flow.
    //
    // This is the only path that actually sends an onboarding *email*. The
    // previous implementation called provisionOrganizationMember(), which
    // created a passwordless Clerk user + an immediately-active membership and
    // sent NOTHING — the invitee never received a link and had no way to set a
    // password, which is exactly the "added a tenant but no invite arrived in
    // Outlook" failure. We now mirror the team-invite flow: revoke any stale
    // pending invite, then createOrganizationInvitation with a /sign-up
    // redirect so the invitee gets the real Clerk email.
    //
    // If the admin is *already* a real Clerk user (re-inviting an existing
    // person, e.g. an internal re-run), Clerk auto-routes them to /sign-in.
    await this.revokeStalePendingInvitation(org.id, adminEmail, actor?.clerkUserId);

    const invitation = await this.clerk.backend.organizations.createOrganizationInvitation({
      organizationId: org.id,
      emailAddress: adminEmail,
      role: 'org:admin',
      // Carry the admin's name through to the sign-up form so Clerk pre-fills
      // it and the webhook persists it on user.created.
      publicMetadata: {
        capiro_tenant_id: tenant.id,
        ...(adminFirstName ? { first_name: adminFirstName } : {}),
        ...(adminLastName ? { last_name: adminLastName } : {}),
      },
      redirectUrl: input.redirectUrl ?? this.defaultInvitationRedirectUrl(),
    });

    // Eagerly create a local "invited" user + membership so the Capiro Admin
    // tenant view shows the pending admin (with name) immediately, before the
    // invitee accepts. The Clerk webhook reconciles clerkUserId on accept.
    await this.prisma.withSystem(async (tx) => {
      const placeholderClerkId = `pending:${invitation.id}`;
      const existingUser =
        (await tx.user.findUnique({ where: { email: adminEmail } })) ?? null;
      const user = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: {
              firstName: adminFirstName ?? existingUser.firstName,
              lastName: adminLastName ?? existingUser.lastName,
            },
          })
        : await tx.user.create({
            data: {
              clerkUserId: placeholderClerkId,
              email: adminEmail,
              firstName: adminFirstName,
              lastName: adminLastName,
            },
          });
      await tx.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        create: {
          tenantId: tenant.id,
          userId: user.id,
          role: 'user_admin',
          status: 'invited',
          invitedBy: actor?.userId,
        },
        update: { role: 'user_admin', invitedBy: actor?.userId ?? undefined },
      });
    });

    return {
      tenant,
      invitation: {
        id: invitation.id,
        email: invitation.emailAddress,
        status: 'invited' as const,
        createdAt: new Date(invitation.createdAt).toISOString(),
        expiresAt: invitation.expiresAt ? new Date(invitation.expiresAt).toISOString() : null,
      },
      clerkOrgId: org.id,
    };
  }

  /**
   * Hard-delete a tenant: remove the Clerk organization (best-effort) and
   * cascade-delete the tenant row in our DB. Every tenant-scoped table has an
   * `onDelete: Cascade` FK to `tenants`, so a single prisma delete removes all
   * dependent data (memberships, clients, meetings, mail, clio, etc.).
   *
   * This is a destructive, capiro_admin-only operation intended for cleaning up
   * test/abandoned tenants. There is no soft-delete recovery.
   */
  async deleteTenant(tenantId: string) {
    const tenant = await this.prisma.withSystem(async (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId } }),
    );
    if (!tenant) throw new NotFoundException('Tenant not found');

    // Step 1: delete the Clerk organization (revokes memberships + pending
    // invitations on Clerk's side). Best-effort — if Clerk is already missing
    // the org, proceed with the local delete so we don't strand the DB row.
    if (tenant.clerkOrgId) {
      await this.clerk.backend.organizations
        .deleteOrganization(tenant.clerkOrgId)
        .catch((err) => {
          this.logger.warn(
            `Clerk deleteOrganization(${tenant.clerkOrgId}) failed: ${(err as Error).message}`,
          );
        });
    }

    // Step 2: cascade-delete the tenant and all tenant-scoped rows.
    await this.prisma.withSystem(async (tx) => {
      await tx.tenant.delete({ where: { id: tenantId } });
    });

    this.logger.log(`Deleted tenant ${tenantId} (${tenant.slug})`);
    return { ok: true, deletedTenantId: tenantId, slug: tenant.slug };
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
        this.logger.warn(`Unable to revoke stale invitation ${stale.id}: ${(err as Error).message}`);
      });
  }

  private defaultInvitationRedirectUrl(): string {
    const override = this.config.get('INVITATION_REDIRECT_URL', { infer: true }) as
      | string
      | undefined;
    if (override) return override;
    const rawOrigin = this.config.get('WEB_ORIGIN', { infer: true }) as string | undefined;
    const firstOrigin = rawOrigin?.split(',')[0]?.trim();
    const origin =
      firstOrigin && /^https?:\/\//.test(firstOrigin) ? firstOrigin : 'https://app.capiro.ai';
    return `${origin.replace(/\/$/, '')}/sign-up`;
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
      // Invitation links must point at /sign-up, not /sign-in: new invitees
      // don't have a Clerk account yet, so the SignUp component is what
      // claims the __clerk_ticket. Existing users get auto-redirected to
      // /sign-in by SignUp's `signInUrl` prop. Pointing at /sign-in
      // directly causes the ticket to be dropped on the SignIn→SignUp
      // bounce. Override with an explicit `redirectUrl` arg when needed.
      redirectUrl:
        redirectUrl ??
        (this.config.get('APP_SIGN_IN_URL', { infer: true }) ?? 'https://app.capiro.ai/sign-in')
          .replace(/\/sign-in\/?$/, '/sign-up'),
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
            // If Clerk-side membership is already gone, our DB still records
            // the removed state from this point forward.
            this.logger.warn(`Clerk delete-membership failed: ${(err as Error).message}`);
          });
      }
      return { ok: true };
    });
  }

  /**
   * Start an impersonation session. Reason required + audit logged. Sessions
   * auto-expire after 60 minutes.
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
    // The standard production path is Clerk's hosted forgot-password flow.
    // Once the SDK exposes password reset tickets here, this method can issue
    // a direct reset link instead of returning the hosted entry point.
    return {
      forgotPasswordUrl: `${this.config.get('APP_SIGN_IN_URL', { infer: true })}#/factor-one`,
      note: 'Send the user the sign-in URL above; they use "Forgot password" on the Clerk hosted UI.',
      clerkUserId,
    };
  }
}
