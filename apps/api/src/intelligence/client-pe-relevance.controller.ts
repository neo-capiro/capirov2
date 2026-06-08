import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { TenantContext } from '@capiro/shared';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { ClientPeRelevanceService } from './client-pe-relevance.service.js';

/**
 * Step 2.3 — explainable client ⇄ Program-Element relevance read endpoints.
 *
 * Kept under `/intelligence` (its own controller, but the same module) deliberately:
 * the relevance service depends only on PrismaService + the pure scorers, so mounting
 * these reads here avoids a cross-module DI edge into the program-element module.
 */

class PeRelevanceQueryDto {
  // Combined-score floor (0..1). Defaults to the service default (0.5) when omitted.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

class ClientRelevanceQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minScore?: number;
}

@Controller('intelligence')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ClientPeRelevanceController {
  constructor(private readonly relevance: ClientPeRelevanceService) {}

  /** PEs relevant to a client, scored + explained, paginated. */
  @Get('clients/:clientId/pe-relevance')
  getRelevantPesForClient(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Query() q: PeRelevanceQueryDto,
  ) {
    return this.relevance.getRelevantPesForClient(ctx, clientId, {
      minScore: q.minScore,
      page: q.page,
      limit: q.limit,
    });
  }

  /** Clients (in the caller's tenant) relevant to a PE, scored + explained. */
  @Get('program-elements/:peCode/client-relevance')
  getRelevantClientsForPe(
    @CurrentTenant() ctx: TenantContext,
    @Param('peCode') peCode: string,
    @Query() q: ClientRelevanceQueryDto,
  ) {
    return this.relevance.getRelevantClientsForPe(ctx, peCode, { minScore: q.minScore });
  }
}
