import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { CreateStrategyDto } from './dto/create-strategy.dto.js';
import { UpdateStrategyDto } from './dto/update-strategy.dto.js';
import { StrategiesService } from './strategies.service.js';

@Controller('strategies')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class StrategiesController {
  constructor(private readonly service: StrategiesService) {}

  // ── Strategy CRUD ─────────────────────────────────────────────────────

  @Post()
  create(@CurrentTenant() ctx: TenantContext, @Body() body: CreateStrategyDto) {
    return this.service.create(ctx.tenantId, ctx.userId, body);
  }

  @Get()
  list(
    @CurrentTenant() ctx: TenantContext,
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list(ctx.tenantId, { clientId, status });
  }

  @Get(':id')
  get(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.get(ctx.tenantId, id);
  }

  @Patch(':id')
  update(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: UpdateStrategyDto,
  ) {
    return this.service.update(ctx.tenantId, id, body);
  }

  @Delete(':id')
  delete(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.delete(ctx.tenantId, id);
  }

  // ── Targets ──────────────────────────────────────────────────────────

  @Post(':id/targets')
  addTarget(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body()
    body: {
      memberName: string;
      memberTitle?: string;
      memberParty?: string;
      memberState?: string;
      committee?: string;
      subcommittee?: string;
      stafferName?: string;
      stafferEmail?: string;
      directoryContactId?: string;
    },
  ) {
    return this.service.addTarget(ctx.tenantId, id, body);
  }

  @Patch(':strategyId/targets/:targetId')
  updateTarget(
    @CurrentTenant() ctx: TenantContext,
    @Param('strategyId') strategyId: string,
    @Param('targetId') targetId: string,
    @Body()
    body: {
      outreachStatus?: string;
      meetingDate?: string | null;
      notes?: string;
      memberTitle?: string;
      committee?: string;
      subcommittee?: string;
      stafferName?: string;
      stafferEmail?: string;
    },
  ) {
    return this.service.updateTarget(ctx.tenantId, strategyId, targetId, body);
  }

  @Delete(':strategyId/targets/:targetId')
  deleteTarget(
    @CurrentTenant() ctx: TenantContext,
    @Param('strategyId') strategyId: string,
    @Param('targetId') targetId: string,
  ) {
    return this.service.deleteTarget(ctx.tenantId, strategyId, targetId);
  }

  // ── Link / Unlink Instances ───────────────────────────────────────────

  @Post(':id/link-instance')
  linkInstance(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { instanceId: string },
  ) {
    return this.service.linkInstance(ctx.tenantId, id, body.instanceId);
  }

  @Post(':id/unlink-instance')
  unlinkInstance(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { instanceId: string },
  ) {
    return this.service.unlinkInstance(ctx.tenantId, id, body.instanceId);
  }

  @Post(':id/create-submissions')
  createSubmissions(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.createSubmissions(ctx.tenantId, ctx.userId, id);
  }
}
