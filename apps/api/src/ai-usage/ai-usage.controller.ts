/**
 * Tenant-facing AI usage + bring-your-own-key endpoints (/api/ai-usage).
 * Gated to tenant admins (user_admin and above). Every read/write is scoped
 * to the caller's own tenant via ctx — there is no tenantId input anywhere
 * on this surface. Credentials are write-only: responses carry last4 only.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { AiUsageService } from './ai-usage.service.js';
import { AiCredentialStoreService, AI_PROVIDERS } from './ai-credential-store.service.js';
import type { AiProvider } from '../engagement/ai-credential-resolver.service.js';

/** '' / whitespace → undefined before validation (same pitfall as outreach DTOs). */
function EmptyToUndefined() {
  return Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  );
}

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

class SaveAiCredentialDto {
  @IsIn(AI_PROVIDERS as readonly string[])
  provider!: AiProvider;

  @IsString()
  @Length(8, 400)
  apiKey!: string;

  @IsOptional()
  @IsString()
  @EmptyToUndefined()
  @Length(1, 80)
  modelOverride?: string;
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

  @Get('credential')
  listCredentials(@CurrentTenant() ctx: TenantContext) {
    return this.store.list(ctx.tenantId);
  }

  @Post('credential')
  saveCredential(@CurrentTenant() ctx: TenantContext, @Body() body: SaveAiCredentialDto) {
    return this.store.upsert(ctx.tenantId, {
      provider: body.provider,
      apiKey: body.apiKey,
      modelOverride: body.modelOverride,
      createdByUserId: ctx.userId,
    });
  }

  @Delete('credential/:provider')
  removeCredential(@CurrentTenant() ctx: TenantContext, @Param('provider') provider: string) {
    if (!(AI_PROVIDERS as readonly string[]).includes(provider)) {
      throw new BadRequestException(`provider must be one of: ${AI_PROVIDERS.join(', ')}`);
    }
    return this.store.remove(ctx.tenantId, provider as AiProvider);
  }
}
