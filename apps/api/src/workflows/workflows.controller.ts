import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { CreateWorkflowInstanceDto } from './dto/create-workflow-instance.dto.js';
import { UpdateWorkflowInstanceDto } from './dto/update-workflow-instance.dto.js';
import {
  GenerateWhitePaperDto,
  GenerateWhitePaperSectionDto,
} from './dto/whitepaper.dto.js';
import { WorkflowsService } from './workflows.service.js';
import { WhitePaperService } from './whitepaper.service.js';

@Controller('workflows')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class WorkflowsController {
  constructor(
    private readonly service: WorkflowsService,
    private readonly whitePaper: WhitePaperService,
  ) {}

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

  @Post('instances/:id/ai-fill')
  aiFillInstance(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { clientId?: string },
  ) {
    if (!body.clientId) throw new BadRequestException('clientId is required');
    return this.service.aiFillInstance(ctx.tenantId, id, body.clientId);
  }

  @Post('instances/:id/ai-enhance-field')
  aiEnhanceField(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { fieldKey?: string; currentValue?: string },
  ) {
    if (!body.fieldKey) throw new BadRequestException('fieldKey is required');
    if (typeof body.currentValue !== 'string' || !body.currentValue.trim()) {
      throw new BadRequestException('currentValue is required');
    }
    return this.service.enhanceField(ctx.tenantId, id, body.fieldKey, body.currentValue);
  }

  @Post('instances/:id/generate-document')
  generateDocument(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: GenerateWhitePaperDto,
  ) {
    return this.whitePaper.generateStructuredDocument(ctx.tenantId, id, {
      variantSlug: body.variantSlug,
      tone: body.tone,
      steerNote: body.steerNote,
      contextItems: body.contextItems,
    });
  }

  @Post('instances/:id/generate-section')
  generateSection(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: GenerateWhitePaperSectionDto,
  ) {
    return this.whitePaper.generateSection(ctx.tenantId, id, body);
  }

  @Get('whitepaper/variants')
  whitePaperVariants() {
    return this.whitePaper.variants();
  }

  @Get('instances/:id/context-candidates')
  contextCandidates(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.whitePaper.contextCandidates(ctx.tenantId, id);
  }

  @Post('instances/:id/whitepaper-lint')
  async whitePaperLint(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    const { sections, variantSlug } = await this.whitePaper.readSections(ctx.tenantId, id);
    return this.whitePaper.lintSections(sections, variantSlug);
  }

  @Get('instances/:id/export.docx')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  async exportDocx(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.whitePaper.exportDocx(ctx.tenantId, id);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
