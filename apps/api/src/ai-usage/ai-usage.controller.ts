/**
 * Tenant-facing AI usage endpoints (/api/ai-usage). Gated to tenant admins
 * (user_admin and above). Every read is scoped to the caller's own tenant via
 * ctx — there is no tenantId input anywhere on this surface.
 *
 * READ-ONLY by design: tenants can see their spend and that a key is
 * configured (masked last-4), but key set/rotate/remove lives EXCLUSIVELY on
 * the capiro-admin console (capiro-admin.controller) — Capiro manages
 * customer keys on their behalf, customers never enter keys themselves.
 */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { AiUsageService } from './ai-usage.service.js';
import { AiCredentialStoreService } from './ai-credential-store.service.js';

class UsageRangeQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

class UsageEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

function parseRange(query: { from?: string; to?: string }) {
  return {
    from: query.from ? new Date(query.from) : undefined,
    to: query.to ? new Date(query.to) : undefined,
  };
}

@Controller('ai-usage')
@UseGuards(RolesGuard)
@Roles('user_admin')
export class AiUsageController {
  constructor(
    private readonly usage: AiUsageService,
    private readonly store: AiCredentialStoreService,
  ) {}

  @Get('summary')
  summary(@CurrentTenant() ctx: TenantContext, @Query() query: UsageRangeQueryDto) {
    return this.usage.tenantSummary(ctx, parseRange(query));
  }

  @Get('events')
  events(@CurrentTenant() ctx: TenantContext, @Query() query: UsageEventsQueryDto) {
    return this.usage.tenantRecentEvents(ctx, { limit: query.limit });
  }

  /** Masked presence only (provider + last4) — never key material. */
  @Get('credential')
  listCredentials(@CurrentTenant() ctx: TenantContext) {
    return this.store.list(ctx.tenantId);
  }
}
