import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TenantGuard } from '../auth/tenant.guard.js';
import { CurrentTenant } from '../auth/current-tenant.decorator.js';
import type { WorkspaceTenantContext } from '../auth/tenant-context.js';
import { ContextService } from './context.service.js';
import { AddContextItemDto } from './dto/context.dto.js';

/** Build Context endpoints (Phase 3, AC-3.6). Client/office-scoped. */
@Controller('context')
@UseGuards(TenantGuard)
export class ContextController {
  constructor(private readonly context: ContextService) {}

  /** GET /workspace-api/context/sources?client=&offices=a,b */
  @Get('sources')
  sources(
    @CurrentTenant() _ctx: WorkspaceTenantContext,
    @Query('client') client?: string,
    @Query('offices') offices?: string,
  ) {
    return this.context.sources(client, splitCsv(offices));
  }

  /** GET /workspace-api/context/news?client=&offices=a,b */
  @Get('news')
  news(
    @CurrentTenant() _ctx: WorkspaceTenantContext,
    @Query('client') client?: string,
    @Query('offices') offices?: string,
  ) {
    return this.context.news(client, splitCsv(offices));
  }
}

/** Draft-scoped context plan (the items the user added). */
@Controller('drafts/:draftId/context')
@UseGuards(TenantGuard)
export class DraftContextController {
  constructor(private readonly context: ContextService) {}

  @Get()
  list(@CurrentTenant() ctx: WorkspaceTenantContext, @Param('draftId') draftId: string) {
    return this.context.listItems(ctx.tenantId, draftId);
  }

  @Post()
  add(
    @CurrentTenant() ctx: WorkspaceTenantContext,
    @Param('draftId') draftId: string,
    @Body() dto: AddContextItemDto,
  ) {
    return this.context.addItem(ctx.tenantId, draftId, dto);
  }

  @Delete(':itemId')
  remove(
    @CurrentTenant() ctx: WorkspaceTenantContext,
    @Param('draftId') draftId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.context.removeItem(ctx.tenantId, draftId, itemId);
  }
}

function splitCsv(v?: string): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}
