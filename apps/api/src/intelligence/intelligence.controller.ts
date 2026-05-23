import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { TenantContext } from '@capiro/shared';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { IntelligenceService } from './intelligence.service.js';
import { InsightGeneratorService } from './insight-generator.service.js';
import { EntityResolutionService } from './entity-resolution.service.js';

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

@Controller('intelligence')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class IntelligenceController {
  constructor(
    private readonly service: IntelligenceService,
    private readonly insights: InsightGeneratorService,
  ) {}

  @Get('client-profile/:clientId')
  getClientProfile(
    @CurrentTenant() ctx: TenantContext,
    @Param('clientId') clientId: string,
  ) {
    return this.service.getClientProfile(clientId, ctx.tenantId);
  }

  @Get('changes')
  getChanges(@Query() q: ChangesQueryDto) {
    return this.service.getChanges(q.since, q.clientId, q.source);
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
}
