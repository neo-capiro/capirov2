import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { TenantContext } from '@capiro/shared';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { IntelligenceService } from './intelligence.service.js';
import { InsightGeneratorService } from './insight-generator.service.js';
import { EntityResolutionService } from './entity-resolution.service.js';
import { ReportCardService } from './report-card.service.js';

class ChangesQueryDto {
  @IsOptional()
  @IsString()
  since?: string;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsString()
  source?: string;
}

class ConfirmMappingDto {
  @IsBoolean()
  @Type(() => Boolean)
  confirmed!: boolean;
}

class GenerateInsightsDto {
  @IsIn(['market', 'client', 'changes'])
  scope!: 'market' | 'client' | 'changes';

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsArray()
  changes?: Array<{ source: string; changeType: string; title: string; description: string }>;
}

class InsightsQueryDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class ReportCardQueryDto {
  @IsOptional()
  @IsIn(['quarter', 'year'])
  period?: 'quarter' | 'year';
}

class OutreachContextQueryDto {
  @IsOptional()
  @IsString()
  recipientOffice?: string;
}

@Controller('intelligence')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class IntelligenceController {
  constructor(
    private readonly service: IntelligenceService,
    private readonly insights: InsightGeneratorService,
    private readonly entityResolution: EntityResolutionService,
    private readonly reportCard: ReportCardService,
  ) {}

  @Get('client-profile/:clientId')
  getClientProfile(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getClientProfile(clientId, ctx.tenantId);
  }

  @Get('clients/:clientId/profile-v1')
  getClientProfileV1(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getClientProfileV1(clientId, ctx.tenantId);
  }

  @Post('resolve-all')
  @Roles('user_admin')
  resolveAll(@CurrentTenant() ctx: TenantContext) {
    return this.entityResolution.resolveAllForTenant(ctx.tenantId);
  }

  @Get('changes/unread-count')
  getUnreadChangesCount() {
    return this.service.getUnreadChangesCount();
  }

  @Patch('changes/:id')
  markChangeConsumed(
    @Param('id') id: string,
    @Body() body: { consumed: boolean },
  ) {
    return this.service.markChangeConsumed(id, body.consumed);
  }

  @Get('changes')
  getChanges(@CurrentTenant() ctx: TenantContext, @Query() q: ChangesQueryDto) {
    return this.service.getChanges(ctx.tenantId, q.since, q.clientId, q.source);
  }

  @Get('clients/:clientId/lobbying-roi')
  getLobbyingRoi(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getLobbyingRoi(clientId, ctx.tenantId);
  }

  @Get('clients/:clientId/fec-money-flow')
  getFecMoneyFlow(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getFecMoneyFlow(clientId, ctx.tenantId);
  }

  @Get('clients/:clientId/competitor-board')
  getCompetitorBoard(@Param('clientId') clientId: string) {
    return this.service.getCompetitorBoard(clientId);
  }

  @Get('clients/:clientId/ex-staffers')
  getExStaffers(@Param('clientId') clientId: string) {
    return this.service.getExStaffers(clientId);
  }

  @Get('clients/:clientId/bills')
  getClientBills(@Param('clientId') clientId: string) {
    return this.service.getClientBills(clientId);
  }

  @Get('clients/:clientId/tracked-bills')
  getTrackedBills(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getTrackedBills(clientId, ctx.tenantId);
  }

  @Get('clients/:clientId/health-score')
  getHealthScore(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.computeEngagementHealth(clientId, ctx.tenantId);
  }

  @Get('issues/:code/leaderboard')
  getIssueLeaderboard(@Param('code') code: string) {
    return this.service.getIssueLeaderboard(code);
  }

  @Get('comment-alerts')
  getCommentAlerts(@CurrentTenant() ctx: TenantContext) {
    return this.service.getCommentPeriodAlerts(ctx.tenantId);
  }

  @Get('today-timeline')
  getTodayTimeline(@CurrentTenant() ctx: TenantContext) {
    return this.service.getTodayTimeline(ctx.tenantId);
  }

  @Get('coming-up')
  getComingUp(@CurrentTenant() ctx: TenantContext) {
    return this.service.getComingUp(ctx.tenantId);
  }

  @Get('portfolio-summary')
  getPortfolioSummary(@CurrentTenant() ctx: TenantContext) {
    return this.service.getPortfolioSummary(ctx.tenantId);
  }

  @Get('live-ticker')
  getLiveTicker(@CurrentTenant() ctx: TenantContext) {
    return this.service.getLiveTicker(ctx.tenantId);
  }

  @Get('daily-brief')
  getDailyBrief(@CurrentTenant() ctx: TenantContext) {
    return this.insights.generateDailyBrief(ctx.tenantId);
  }

  @Get('mappings')
  getAllMappings(@CurrentTenant() ctx: TenantContext) {
    return this.service.getAllMappingsForTenant(ctx.tenantId);
  }

  @Get('mappings/:clientId')
  getMappings(@Param('clientId') clientId: string) {
    return this.service.getMappings(clientId);
  }

  @Post('mappings/:clientId/resolve')
  resolveMapping(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.resolveMapping(clientId, ctx.tenantId);
  }

  @Patch('mappings/:mappingId')
  confirmMapping(
    @Param('mappingId') mappingId: string,
    @Body() body: ConfirmMappingDto,
  ) {
    return this.service.confirmMapping(mappingId, body.confirmed);
  }

  // ── Feature 4.1: Report Card ───────────────────────────────────────────

  @Get('clients/:clientId/report-card')
  getReportCard(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Query() q: ReportCardQueryDto,
  ) {
    return this.reportCard.generateReportCard(clientId, ctx.tenantId, q.period ?? 'quarter');
  }

  @Get('clients/:clientId/report-card/export')
  exportReportCard(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Query() q: ReportCardQueryDto,
  ) {
    return this.reportCard.generateReportCard(clientId, ctx.tenantId, q.period ?? 'quarter');
  }

  // ── Feature 4.2: Knowledge Graph ───────────────────────────────────────

  @Get('clients/:clientId/knowledge-graph')
  getKnowledgeGraph(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getKnowledgeGraph(clientId, ctx.tenantId);
  }

  // ── Feature 4.3: Outreach Context ──────────────────────────────────────

  @Get('clients/:clientId/outreach-context')
  getOutreachContext(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Query() q: OutreachContextQueryDto,
  ) {
    return this.service.getOutreachContext(clientId, ctx.tenantId, q.recipientOffice);
  }

  // ── AI Insight Pipeline (Phase 4) ──────────────────────────────────────

  @Post('insights/generate')
  generateInsights(
    @CurrentTenant() ctx: TenantContext,
    @Body() body: GenerateInsightsDto,
  ) {
    switch (body.scope) {
      case 'market':
        return this.insights.generateMarketInsights();
      case 'client':
        return this.insights.generateClientBriefing(body.clientId!, ctx.tenantId);
      case 'changes':
        return this.insights.generateFromChanges(body.changes ?? []);
    }
  }

  @Get('insights')
  getInsights(@Query() q: InsightsQueryDto) {
    return this.insights.getInsights(q.category, q.severity, q.limit);
  }

  @Get('briefing/:clientId')
  getBriefing(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.insights.generateClientBriefing(clientId, ctx.tenantId);
  }

  // ─── Phase 2 cross-references ─────────────────────────────────────────

  @Get('clients/:clientId/district-nexus')
  getDistrictNexus(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getDistrictNexus(clientId, ctx.tenantId);
  }

  @Get('clients/:clientId/district-nexus-spend')
  getDistrictNexusSpend(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getDistrictNexusSpend(clientId, ctx.tenantId);
  }

  @Get('clients/:clientId/bill-regulation-links')
  getBillRegulationLinks(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getBillRegulationLinks(clientId, ctx.tenantId);
  }

  @Get('clients/:clientId/bill-research')
  getBillResearchAttachments(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getBillResearchAttachments(clientId, ctx.tenantId);
  }

  // ─── Manual bill tracking (user-pinned legislation per client) ─────────

  @Get('clients/:clientId/tracked-bills/manual')
  listManualTrackedBills(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.listTrackedBills(clientId, ctx.tenantId);
  }

  @Post('clients/:clientId/tracked-bills')
  addManualTrackedBill(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Body() body: { billId: string; note?: string },
  ) {
    return this.service.addTrackedBill(clientId, ctx.tenantId, body.billId, body.note, ctx.userId);
  }

  @Delete('clients/:clientId/tracked-bills/:billId')
  removeManualTrackedBill(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
    @Param('billId') billId: string,
  ) {
    return this.service.removeTrackedBill(clientId, ctx.tenantId, billId);
  }
}
