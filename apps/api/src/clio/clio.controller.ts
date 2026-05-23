import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { Request, Response } from 'express';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { ClioService } from './clio.service.js';
import { ClioToolsService } from './clio-tools.service.js';

class CreateClioConversationDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  title?: string;
}

class SendClioMessageDto {
  @IsString()
  @Length(1, 24_000)
  body!: string;
}

@Controller('clio')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ClioController {
  constructor(
    private readonly service: ClioService,
    private readonly tools: ClioToolsService,
  ) {}

  @Get('status')
  status(@CurrentTenant() ctx: TenantContext) {
    return this.service.status(ctx);
  }

  @Get('conversations')
  conversations(@CurrentTenant() ctx: TenantContext) {
    return this.service.listConversations(ctx);
  }

  @Post('conversations')
  createConversation(@CurrentTenant() ctx: TenantContext, @Body() body: CreateClioConversationDto) {
    return this.service.createConversation(ctx, body);
  }

  @Get('conversations/:id')
  conversation(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.getConversation(ctx, id);
  }

  @Get('conversations/:id/messages')
  messages(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.listMessages(ctx, id);
  }

  @Post('conversations/:id/messages')
  sendMessage(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: SendClioMessageDto,
  ) {
    return this.service.sendMessage(ctx, id, body.body);
  }

  @Post('conversations/:id/stream')
  async streamMessage(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: SendClioMessageDto,
    @Req() _req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    await this.service.streamMessage(ctx, id, body.body, res);
    res.end();
  }

  @Get('tools')
  toolManifest() {
    return this.tools.manifest();
  }

  @Post('tools/:name')
  executeTool(
    @CurrentTenant() ctx: TenantContext,
    @Param('name') name: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tools.executeFromAuthenticatedUser(ctx, name, body);
  }

  // ── Clio Email endpoints ──

  @Get('emails')
  listEmails(
    @CurrentTenant() ctx: TenantContext,
    @Query('clientId') clientId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.tools.executeFromAuthenticatedUser(ctx, 'list_emails', {
      clientId: clientId || undefined,
      limit: limit ? parseInt(limit, 10) : 15,
    });
  }

  @Post('emails/send')
  sendEmail(@CurrentTenant() ctx: TenantContext, @Body() body: Record<string, unknown>) {
    return this.tools.executeFromAuthenticatedUser(ctx, 'send_email', body);
  }

  @Post('emails/reply')
  replyEmail(@CurrentTenant() ctx: TenantContext, @Body() body: Record<string, unknown>) {
    return this.tools.executeFromAuthenticatedUser(ctx, 'reply_email', body);
  }

  // ── Proactive Alerts ──

  @Get('alerts')
  async listAlerts(@CurrentTenant() ctx: TenantContext) {
    return this.service.listAlerts(ctx);
  }

  @Post('alerts/:id/dismiss')
  async dismissAlert(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.dismissAlert(ctx, id);
  }

  // ── Artifact Versioning ──

  @Post('artifacts/:id/version')
  async createArtifactVersion(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: { bodyText: string },
  ) {
    return this.service.createArtifactVersion(ctx, id, body.bodyText);
  }
}

@Controller('clio/runtime')
export class ClioRuntimeController {
  constructor(private readonly tools: ClioToolsService) {}

  @Post('tools/:name')
  executeRuntimeTool(
    @Req() req: Request,
    @Param('name') name: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.tools.executeFromRuntime(req.headers.authorization, name, body);
  }
}
