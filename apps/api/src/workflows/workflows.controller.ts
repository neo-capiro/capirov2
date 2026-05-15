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
import { CreateWorkflowInstanceDto } from './dto/create-workflow-instance.dto.js';
import { UpdateWorkflowInstanceDto } from './dto/update-workflow-instance.dto.js';
import { WorkflowsService } from './workflows.service.js';

@Controller('workflows')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class WorkflowsController {
  constructor(private readonly service: WorkflowsService) {}

  @Get('templates')
  listTemplates() {
    return this.service.listTemplates();
  }

  @Get('templates/:slug')
  getTemplate(@Param('slug') slug: string) {
    return this.service.getTemplateBySlug(slug);
  }

  @Post('instances')
  createInstance(@CurrentTenant() ctx: TenantContext, @Body() body: CreateWorkflowInstanceDto) {
    return this.service.createInstance(ctx.tenantId, ctx.userId, body);
  }

  @Get('instances')
  listInstances(
    @CurrentTenant() ctx: TenantContext,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
  ) {
    return this.service.listInstances(ctx.tenantId, { status, clientId });
  }

  @Get('instances/:id')
  getInstance(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.getInstance(ctx.tenantId, id);
  }

  @Patch('instances/:id')
  updateInstance(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: UpdateWorkflowInstanceDto,
  ) {
    return this.service.updateInstance(ctx.tenantId, id, body);
  }

  @Delete('instances/:id')
  deleteInstance(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.deleteInstance(ctx.tenantId, id);
  }
}
