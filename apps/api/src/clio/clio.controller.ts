import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { IsObject, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import type { Request, Response } from 'express';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { ClioService } from './clio.service.js';
import { ClioToolsService } from './clio-tools.service.js';
import { ClioResearchService } from './clio-research.service.js';
import { renderReportToBrowserHtml, renderReportToWordHtml } from './clio-research.helpers.js';

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

class UpdateClioConversationDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  title?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  clientId?: string | null;
}

class CreateResearchSessionDto {
  @IsString()
  @Length(1, 4_000)
  topic!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  clientId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  title?: string;
}

class AnswerClarificationsDto {
  @IsObject()
  answers!: Record<string, string>;
}

@Controller('clio')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ClioController {
  constructor(
    private readonly service: ClioService,
    private readonly tools: ClioToolsService,
    private readonly research: ClioResearchService,
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

  @Patch('conversations/:id')
  updateConversation(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: UpdateClioConversationDto,
  ) {
    return this.service.updateConversation(ctx, id, body);
  }

  @Patch('conversations/:id/archive')
  archiveConversation(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.archiveConversation(ctx, id);
  }

  @Patch('conversations/:id/restore')
  restoreConversation(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.restoreConversation(ctx, id);
  }

  @Get('conversations/:id/messages')
  messages(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.listMessages(ctx, id);
  }

  @Post('conversations/:id/stream')
  async streamMessage(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: SendClioMessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // Cancel the model stream when the client disconnects or hits Stop, so we
    // stop burning tokens for an answer no one is reading (P0-4).
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    res.on('error', () => { /* swallow socket errors on client disconnect */ });
    await this.service.streamMessage(ctx, id, body.body, res, abort.signal);
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

  // ── Learned-memory surface (Clio learned X + one-click undo) ──

  @Get('memory/recent')
  async recentLearnedMemories(
    @CurrentTenant() ctx: TenantContext,
    @Query('limit') limit?: string,
  ) {
    return this.service.listRecentLearnedMemories(ctx, limit ? parseInt(limit, 10) : 5);
  }

  @Delete('memory/:id')
  async forgetMemory(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.service.forgetMemory(ctx, id);
  }

  // ── Deep Research ──
  // Flow: POST /research (create) → POST /research/:id/plan/stream (SSE: plan +
  // clarifying questions) → POST /research/:id/clarify (answers) →
  // POST /research/:id/stream (SSE: agentic gather + synthesized cited report).

  @Get('research')
  listResearch(@CurrentTenant() ctx: TenantContext) {
    return this.research.listSessions(ctx);
  }

  @Post('research')
  createResearch(@CurrentTenant() ctx: TenantContext, @Body() body: CreateResearchSessionDto) {
    return this.research.createSession(ctx, body);
  }

  @Get('research/:id')
  getResearch(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.research.getSession(ctx, id);
  }

  @Delete('research/:id')
  deleteResearch(@CurrentTenant() ctx: TenantContext, @Param('id') id: string) {
    return this.research.deleteSession(ctx, id);
  }

  @Post('research/:id/clarify')
  answerResearch(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: AnswerClarificationsDto,
  ) {
    return this.research.answerClarifications(ctx, id, body.answers);
  }

  // Export the completed report as a Microsoft Word–openable document. We emit a
  // Word-compatible HTML `.doc` (opens natively in Word with full formatting),
  // which needs no docx library.
  @Get('research/:id/export/word')
  async exportResearchWord(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { title, markdown } = await this.research.getReportMarkdown(ctx, id);
    const html = renderReportToWordHtml({ title, markdown });
    const filename = `${slugifyFilename(title)}.doc`;
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(html);
  }

  // Render the completed report as a clean, branded, printable HTML page —
  // "write to the browser" / open-in-new-tab surface.
  @Get('research/:id/export/html')
  async exportResearchHtml(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { title, markdown } = await this.research.getReportMarkdown(ctx, id);
    const html = renderReportToBrowserHtml({ title, markdown });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Post('research/:id/plan/stream')
  async streamResearchPlan(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Req() _req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    await this.research.streamPlan(ctx, id, res);
    res.end();
  }

  @Post('research/:id/stream')
  async streamResearchRun(
    @CurrentTenant() ctx: TenantContext,
    @Param('id') id: string,
    @Req() _req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    await this.research.streamResearch(ctx, id, res);
    res.end();
  }
}

/** Filesystem-safe slug for a download filename. */
function slugifyFilename(title: string): string {
  const slug = (title || 'research-report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'research-report';
}