import { Controller, Get } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Demo controller proving the RLS round-trip works end-to-end:
 *   GET /me            → identity from the Clerk JWT + the chosen tenant
 *   GET /me/memberships → only memberships for the active tenant are visible
 *
 * The membership query runs through `withTenant`, so RLS enforces the scope.
 * If you swap tenant_id in `withTenant` to a different tenant, the same query
 * returns zero rows — that's the fail-closed behavior we want.
 */
@Controller()
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  me(@CurrentTenant() ctx: TenantContext) {
    return {
      user: {
        id: ctx.userId,
        clerkUserId: ctx.clerkUserId,
      },
      tenant: {
        id: ctx.tenantId,
        slug: ctx.tenantSlug,
      },
      role: ctx.role,
    };
  }

  @Get('me/memberships')
  async memberships(@CurrentTenant() ctx: TenantContext) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.tenantMembership.findMany({
        where: { userId: ctx.userId },
        include: { tenant: { select: { id: true, slug: true, name: true } } },
      });
      return rows.map((m) => ({
        membershipId: m.id,
        tenant: m.tenant,
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt,
      }));
    });
  }
}
