import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import type { Request } from 'express';
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
