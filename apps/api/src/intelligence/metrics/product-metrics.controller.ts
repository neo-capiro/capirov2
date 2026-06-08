import { Controller, Get, UseGuards } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../../auth/roles.decorator.js';
import { RolesGuard } from '../../auth/roles.guard.js';
import { CurrentTenant } from '../../tenant/current-tenant.decorator.js';
import { ProductMetricsService } from './product-metrics.service.js';

/**
 * Step 4.1 — product analytics endpoint (§24). Tenant-scoped via RolesGuard +
 * @Roles('standard_user'); the service enforces RLS through `withTenant`. Read-only.
 *
 * `GET /api/intelligence/metrics/product` returns weekly generated/accepted/dismissed
 * counts, the north-star (client-specific source-backed actions accepted per week), and
 * the median delta→card latency. Definitions for "accepted"/"north-star" are echoed in
 * the response so the consumer renders the caveats rather than guessing.
 */
@Controller('intelligence/metrics')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ProductMetricsController {
  constructor(private readonly service: ProductMetricsService) {}

  @Get('product')
  product(@CurrentTenant() ctx: TenantContext) {
    return this.service.getProductMetrics(ctx);
  }
}
