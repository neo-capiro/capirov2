import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { ChatService } from './chat.service.js';
import { EditDraftDto, EditWorkflowDto, SendMessageDto } from './dto/chat-message.dto.js';

@Controller('chat')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('session')
  createSession(@CurrentTenant() ctx: TenantContext) {
    return this.chatService.createSession(ctx);
  }

  @Get('history')
  getHistory(
    @CurrentTenant() ctx: TenantContext,
    @Query('sessionId') sessionId: string,
  ) {
    return this.chatService.getHistory(ctx, sessionId);
  }

  @Delete('session/:id')
  deleteSession(@CurrentTenant() ctx: TenantContext, @Param('id') sessionId: string) {
    return this.chatService.deleteSession(ctx, sessionId);
  }

  @Post('message')
  async sendMessage(
    @CurrentTenant() ctx: TenantContext,
    @Body() body: SendMessageDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      await this.chatService.streamMessage(ctx, body, res as unknown as globalThis.Response & { write: (chunk: string) => void; end: () => void });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
    } finally {
      res.end();
    }
  }

  @Post('edit-draft')
  editDraft(@CurrentTenant() ctx: TenantContext, @Body() body: EditDraftDto) {
    return this.chatService.editDraft(ctx, body);
  }

  @Post('edit-workflow')
  editWorkflow(@CurrentTenant() ctx: TenantContext, @Body() body: EditWorkflowDto) {
    return this.chatService.editWorkflow(ctx, body);
  }
}
