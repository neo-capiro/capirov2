import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../../auth/roles.decorator.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { CurrentTenant } from '../../tenant/current-tenant.decorator.js';
import { CoverageGapService } from './coverage-gap.service.js';

/**
 * Step 3.4 — relationship-coverage GAP read/write API (plan §14).
 *
 * Mounted under `/intelligence` (own controller, same module — mirrors
 * ClientPeRelevanceController / ActionRecommendationController). Tenant-scoped via
 * RolesGuard + @Roles(standard_user); the service enforces RLS through withTenant. The
 * global ValidationPipe runs whitelist + forbidNonWhitelisted, so every DTO field MUST
 * carry a class-validator decorator.
 */

class ClientCoverageQueryDto {
  /** The PE to compute coverage for, in this client's context. Required. */
  @IsString()
  peCode!: string;
}

class CreateOutreachDto {
  // Supply EITHER actionId, OR (peCode + clientId).
  @IsOptional()
  @IsUUID()
  actionId?: string;

  @IsOptional()
  @IsString()
  peCode?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsString()
  @IsUUID()
  officeId!: string;

  @IsOptional()
  @ValidateIf((o: CreateOutreachDto) => o.personId !== null && o.personId !== undefined)
  @IsUUID()
  personId?: string;

  @IsString()
  @IsUUID()
  ownerUserId!: string;
}

@Controller('intelligence')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class CoverageController {
  constructor(private readonly coverage: CoverageGapService) {}

  /** Relationship coverage for the PE behind an action card, with the card's why-now. */
  @Get('actions/:id/coverage')
  getForAction(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.coverage.getCoverageForAction(ctx, id);
  }

  /** Relationship coverage for a (client, PE) pair. `peCode` is a required query param. */
  @Get('clients/:clientId/coverage')
  getForClient(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Query() q: ClientCoverageQueryDto,
  ) {
    return this.coverage.getCoverageForPe(ctx, q.peCode, { clientId });
  }

  /** Create a schedule_outreach action card from a coverage gap, assigned to an owner. */
  @Post('coverage/outreach')
  createOutreach(@CurrentTenant() ctx: TenantContext, @Body() body: CreateOutreachDto) {
    return this.coverage.createOutreachFromGap(ctx, {
      actionId: body.actionId,
      peCode: body.peCode,
      clientId: body.clientId,
      officeId: body.officeId,
      personId: body.personId,
      ownerUserId: body.ownerUserId,
    });
  }
}
