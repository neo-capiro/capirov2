import {
  ForbiddenException,
  Injectable,
  Logger,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TENANT_HEADER, type TenantContext, type TenantRole } from '@capiro/shared';
import { ClerkService, type ClerkSessionClaims } from '../auth/clerk.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextStore } from './tenant-context.store.js';

/**
 * Resolves the tenant context for an authenticated request.
 *
 * Order of operations:
 *   1. Verify the Clerk session JWT (Authorization: Bearer ...).
 *   2. Resolve the requested tenant. Preference order:
 *        a. `capiro_tenant_id` from the Clerk JWT template (fast path — no
 *            membership scan needed; the org_id claim is cross-checked
 *            against tenants.clerk_org_id).
 *        b. X-Capiro-Tenant header.
 *        c. Subdomain match — `{slug}.app.capiro.ai`.
 *        d. Sole-membership fallback — if the user has exactly one active
 *            membership and none of the above produced a hint, use it.
 *   3. Look up the membership using RLS bypass (the lookup itself is not
 *      tenant-scoped because we are still resolving which tenant to use).
 *   4. Cross-check: if the JWT carries `org_id`, the resolved tenant's
 *      `clerk_org_id` MUST match. Mismatch → 403.
 *   5. Propagate the context via AsyncLocalStorage + req.tenantContext.
 *
 * This is the JWT/host integrity check called out in arch §2.2 and §8.2.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);

  constructor(
    private readonly clerk: ClerkService,
    private readonly prisma: PrismaService,
    private readonly store: TenantContextStore,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Step 1 — verify Clerk JWT.
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = auth.slice('bearer '.length).trim();

    let claims: ClerkSessionClaims;
    try {
      claims = await this.clerk.verifySessionToken(token);
    } catch {
      throw new UnauthorizedException('Invalid session token');
    }

    // Step 2 — gather every hint we have about which tenant is being requested.
    // Empty strings from the JWT template (when the user has no active org)
    // are normalized to undefined so the downstream logic only sees real
    // signals.
    const requestedSlug = this.resolveRequestedTenantSlug(req);
    const claimedTenantId = nonEmpty(claims.capiro_tenant_id);
    const claimedTenantSlug = nonEmpty(claims.capiro_tenant_slug);
    const claimedOrgId = nonEmpty(claims.org_id);

    // Step 3 — resolve membership using RLS bypass. The lookup is not
    // tenant-scoped (we are still resolving the tenant), so it MUST run
    // through the system path.
    const ctx = await this.prisma.withSystem(async (tx) => {
      const user = await tx.user.findUnique({ where: { clerkUserId: claims.sub } });
      if (!user) {
        // First-time authenticated request from this Clerk user. The webhook
        // is the canonical source of users, but a slow webhook should not
        // block sign-in — best-effort upsert keeps things flowing.
        await tx.user.create({
          data: {
            clerkUserId: claims.sub,
            email: claims.email ?? `${claims.sub}@unknown.invalid`,
          },
        });
        throw new ForbiddenException('User has no tenant memberships');
      }

      const memberships = await tx.tenantMembership.findMany({
        where: { userId: user.id, status: 'active' },
        include: { tenant: true },
      });

      if (memberships.length === 0) {
        throw new ForbiddenException('User has no active tenant memberships');
      }

      // Match by every hint we have, in preference order. The JWT-claim
      // matches are the fast path: if the Clerk JWT template populated
      // capiro_tenant_id, we trust it (after the org_id cross-check below).
      const chosen =
        memberships.find((m) => claimedTenantId && m.tenantId === claimedTenantId) ??
        memberships.find((m) => claimedOrgId && m.tenant.clerkOrgId === claimedOrgId) ??
        memberships.find(
          (m) => claimedTenantSlug && m.tenant.slug === claimedTenantSlug.toLowerCase(),
        ) ??
        memberships.find((m) => requestedSlug && m.tenant.slug === requestedSlug) ??
        // Sole-membership fallback only when no signal at all was supplied.
        (memberships.length === 1 &&
        !claimedTenantId &&
        !claimedOrgId &&
        !claimedTenantSlug &&
        !requestedSlug
          ? memberships[0]
          : undefined);

      if (!chosen) {
        throw new ForbiddenException(
          'No matching tenant for the supplied identifier — re-auth required',
        );
      }

      // Step 4 — integrity cross-checks. If the JWT and the resolved tenant
      // disagree on any identifier, force re-auth. Each branch covers a
      // different way an attacker could try to pivot tenants.
      if (claimedTenantId && chosen.tenantId !== claimedTenantId) {
        throw new ForbiddenException('Tenant claim mismatch — re-auth required');
      }
      if (claimedOrgId && chosen.tenant.clerkOrgId !== claimedOrgId) {
        throw new ForbiddenException('Org claim mismatch — re-auth required');
      }
      if (
        claimedTenantSlug &&
        chosen.tenant.slug.toLowerCase() !== claimedTenantSlug.toLowerCase()
      ) {
        throw new ForbiddenException('Tenant slug claim mismatch — re-auth required');
      }
      if (requestedSlug && chosen.tenant.slug !== requestedSlug) {
        throw new ForbiddenException('Subdomain/header tenant mismatch — re-auth required');
      }

      // Best-effort last_seen_at update — do not fail the request on error.
      await tx.user
        .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);

      // Impersonation override (capiro_admin only). If the caller is a
      // capiro_admin AND has an active session AND the request carries the
      // x-capiro-impersonate-tenant header, swap the tenant context to the
      // impersonated tenant. Every request executed under impersonation is
      // attributed to the actor (audit_logs.actor_user_id) so reads/writes
      // are traceable.
      const wantsImpersonate = req.header('x-capiro-impersonate-tenant')?.trim().toLowerCase();
      if (wantsImpersonate && chosen.role === 'capiro_admin') {
        const session = await tx.impersonationSession.findFirst({
          where: { actorUserId: user.id, endedAt: null, expiresAt: { gt: new Date() } },
          include: { tenant: true },
        });
        if (!session) {
          throw new ForbiddenException(
            'No active impersonation session — start one via /capiro-admin/impersonate',
          );
        }
        if (session.tenant.slug.toLowerCase() !== wantsImpersonate) {
          throw new ForbiddenException(
            `Impersonation session is for tenant ${session.tenant.slug}, header asks for ${wantsImpersonate}`,
          );
        }
        const context: TenantContext = {
          tenantId: session.tenantId,
          tenantSlug: session.tenant.slug,
          userId: user.id,
          clerkUserId: user.clerkUserId,
          role: 'capiro_admin', // role stays — capiro_admin acting as
        };
        return context;
      }

      const context: TenantContext = {
        tenantId: chosen.tenantId,
        tenantSlug: chosen.tenant.slug,
        userId: user.id,
        clerkUserId: user.clerkUserId,
        role: chosen.role as TenantRole,
      };
      return context;
    });

    // Step 4 — propagate via AsyncLocalStorage AND req object. ALS lets
    // services pull the context without prop drilling; req.tenantContext is
    // for the @CurrentTenant() decorator and direct controller access.
    (req as Request & { tenantContext?: TenantContext }).tenantContext = ctx;
    this.store.run(ctx, () => next());
  }

  private resolveRequestedTenantSlug(req: Request): string | undefined {
    const headerVal = req.header(TENANT_HEADER);
    if (headerVal) return headerVal.trim().toLowerCase();

    const host = req.hostname; // e.g. acmelobby.app.capiro.ai
    const parts = host.split('.');
    // {slug}.app.capiro.ai — only treat as a tenant slug when the shape AND
    // TLD match. Strict matching prevents a malicious host header from
    // injecting an arbitrary slug via a lookalike domain.
    if (
      parts.length === 4 &&
      parts[1] === 'app' &&
      parts[2] === 'capiro' &&
      parts[3] === 'ai'
    ) {
      return parts[0]?.toLowerCase();
    }
    return undefined;
  }
}

// Clerk's JWT template emits empty strings for `{{org.*}}` placeholders when
// the user has no active org. We treat empty as "no signal" rather than
// matching a tenant whose slug is literally "".
function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
