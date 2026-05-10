import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import type { TenantContext } from '@capiro/shared';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentTenant } from '../tenant/current-tenant.decorator.js';
import { ClioService } from './clio.service.js';

class CreateSessionDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  systemPrompt?: string;
}

class SendMessageDto {
  @IsString()
  @Length(1, 32_000)
  content!: string;
}

/**
 * Workspace-facing Clio endpoints. All routes are tenant-scoped via the
 * existing tenant context middleware + RolesGuard. The web app never
 * talks to the Clio runtime directly; it only sees this controller.
 */
@Controller('clio')
@UseGuards(RolesGuard)
@Roles('capiro_admin', 'user_admin', 'standard_user')
export class ClioController {
  constructor(private readonly clio: ClioService) {}

  @Get('sessions')
  list(@CurrentTenant() ctx: TenantContext) {
    return this.clio.listSessions(ctx);
  }

  @Post('sessions')
  create(@CurrentTenant() ctx: TenantContext, @Body() body: CreateSessionDto) {
    return this.clio.createSession(ctx, body);
  }

  @Get('sessions/:id')
  get(@CurrentTenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.clio.getSession(ctx, id);
  }

  @Post('sessions/:id/messages')
  send(
    @CurrentTenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendMessageDto,
  ) {
    return this.clio.sendMessage(ctx, id, body);
  }

  @Delete('sessions/:id')
  async archive(@CurrentTenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.clio.archiveSession(ctx, id);
    return { ok: true };
  }
}
