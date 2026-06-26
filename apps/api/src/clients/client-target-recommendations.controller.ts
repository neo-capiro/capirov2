import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { ClientTargetRecommendationsService } from './client-target-recommendations.service.js';

/**
 * "Suggested by Meri" office recommendations for the client Targets tab.
 *
 *   GET  /api/clients/:clientId/target-recommendations          → cached (computes
 *        and persists on the first view), so subsequent views are instant.
 *   POST /api/clients/:clientId/target-recommendations/refresh  → force recompute.
 *
 * Mounted in ClientsModule, which imports IntelligenceModule (the compute path).
 */
@Controller('clients/:clientId/target-recommendations')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ClientTargetRecommendationsController {
  constructor(private readonly service: ClientTargetRecommendationsService) {}

  @Get()
  get(@CurrentTenant() ctx: TenantContext, @Param('clientId') clientId: string) {
    return this.service.getRecommendations(ctx, clientId);
  }

  @Post('refresh')
  refresh(@CurrentTenant() ctx: TenantContext, @Param('clientId') clientId: string) {
    return this.service.getRecommendations(ctx, clientId, { refresh: true });
  }
}
