import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

/**
 * Demo controller proving the RLS round-trip works end-to-end:
 *   GET /me            → identity from the Clerk JWT + the chosen tenant
 *   PATCH /me          → update mutable profile fields (currently just `title`)
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
  async me(@CurrentTenant() ctx: TenantContext) {
    const profile = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const [user, tenant] = await Promise.all([
        tx.user.findUnique({
          where: { id: ctx.userId },
          select: { email: true, firstName: true, lastName: true, title: true },
        }),
        tx.tenant.findUnique({
          where: { id: ctx.tenantId },
          select: { name: true },
        }),
      ]);
      return { user, tenant };
    });

    return {
      user: {
        id: ctx.userId,
        clerkUserId: ctx.clerkUserId,
        email: profile.user?.email ?? null,
        firstName: profile.user?.firstName ?? null,
        lastName: profile.user?.lastName ?? null,
        title: profile.user?.title ?? null,
      },
      tenant: {
        id: ctx.tenantId,
        slug: ctx.tenantSlug,
        name: profile.tenant?.name ?? ctx.tenantSlug,
      },
      role: ctx.role,
    };
  }

  @Patch('me')
  async updateMe(@CurrentTenant() ctx: TenantContext, @Body() body: UpdateMeDto) {
    // Only `title` is editable from the client for now. firstName/lastName/email
    // are owned by Clerk and synced on login.
    if (body.title === undefined) {
      throw new BadRequestException('No editable fields provided');
    }
    const normalized = body.title?.trim() ?? '';
    const next = normalized.length ? normalized : null;
    const user = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.user.update({
        where: { id: ctx.userId },
        data: { title: next },
        select: { email: true, firstName: true, lastName: true, title: true },
      }),
    );
    return {
      user: {
        id: ctx.userId,
        clerkUserId: ctx.clerkUserId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        title: user.title,
      },
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
