import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { QueryProgramElementsDto } from './dto/query-program-elements.dto.js';
import { WatchProgramElementDto } from './dto/watch-program-element.dto.js';
import { ProgramElementReadService } from './program-element-read.service.js';

@Controller('program-elements')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ProgramElementController {
  constructor(private readonly service: ProgramElementReadService) {}

  // Static admin route declared before the ':peCode' dynamic route so 'admin' is
  // not captured as a peCode. capiro_admin only (Step 29 reconciliation queue).
  @Get('admin/reconciliation-queue')
  @Roles('capiro_admin')
  reconciliationQueue(@Query() query: QueryProgramElementsDto) {
    return this.service.listReconciliationQueue(query.status ?? 'open', query.page, query.limit);
  }

  @Get()
  list(@CurrentTenant() ctx: TenantContext, @Query() query: QueryProgramElementsDto) {
    return this.service.listProgramElements(
      {
        service: query.service,
        budgetActivity: query.budget_activity,
        q: query.q,
        page: query.page,
        limit: query.limit,
        mode: query.mode,
        divergenceThreshold: query.divergence_threshold,
        hasData: query.has_data,
      },
      ctx,
    );
  }

  @Get(':peCode')
  detail(@CurrentTenant() ctx: TenantContext, @Param('peCode') peCode: string) {
    return this.service.getProgramElement(peCode, ctx);
  }

  @Get(':peCode/timeline')
  timeline(@Param('peCode') peCode: string) {
    return this.service.getTimeline(peCode);
  }

  @Get(':peCode/bills')
  bills(@Param('peCode') peCode: string) {
    return this.service.getBills(peCode);
  }

  @Get(':peCode/contractors')
  contractors(@Param('peCode') peCode: string) {
    return this.service.getContractors(peCode);
  }

  @Get(':peCode/related')
  related(@Param('peCode') peCode: string) {
    return this.service.getRelatedProgramElements(peCode);
  }

  @Post(':peCode/watch')
  watch(
    @CurrentTenant() ctx: TenantContext,
    @Param('peCode') peCode: string,
    @Body() body: WatchProgramElementDto,
  ) {
    return this.service.setWatching(peCode, body.watching, ctx);
  }
}
