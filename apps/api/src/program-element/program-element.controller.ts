import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { QueryProgramElementsDto } from './dto/query-program-elements.dto.js';
import { WatchProgramElementDto } from './dto/watch-program-element.dto.js';
import { ProgramElementReadService, type ReconciliationDecision } from './program-element-read.service.js';
import { ProgramElementWriterService } from './program-element-writer.service.js';
import { MANUAL_OVERRIDE_SOURCE, type PeYearInput } from './types.js';

class ResolveReconciliationDto {
  @IsIn(['keep_current', 'accept_conflicting', 'manual_value'])
  decision!: ReconciliationDecision;

  /** Required for decision=manual_value; numeric value in $ millions. */
  @IsOptional()
  @IsNumber()
  manualValue?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('program-elements')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ProgramElementController {
  constructor(
    private readonly service: ProgramElementReadService,
    private readonly writer: ProgramElementWriterService,
  ) {}

  // Static admin route declared before the ':peCode' dynamic route so 'admin' is
  // not captured as a peCode. capiro_admin only (Step 29 reconciliation queue).
  @Get('admin/reconciliation-queue')
  @Roles('capiro_admin')
  reconciliationQueue(@Query() query: QueryProgramElementsDto) {
    return this.service.listReconciliationQueue(query.status ?? 'open', query.page, query.limit);
  }

  // Resolve a queued conflict. accept_conflicting/manual_value write the chosen value through
  // the writer's manual_override path (canonical update + is_winner flip). capiro_admin only.
  @Post('admin/reconciliation-queue/:id/resolve')
  @Roles('capiro_admin')
  resolveReconciliation(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: ResolveReconciliationDto,
  ) {
    return this.service.resolveReconciliation(
      id,
      { decision: body.decision, manualValue: body.manualValue, notes: body.notes },
      ctx,
      async (peCode: string, fy: number, fieldName: string, value: number) => {
        const record: PeYearInput = { peCode, fy };
        (record as unknown as Record<string, unknown>)[fieldName] = value;
        await this.writer.upsertProgramElementYear(record, MANUAL_OVERRIDE_SOURCE);
      },
    );
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
