import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { MemoryStoreService } from './memory-store.service.js';
import type { MemoryItemType } from './memory.types.js';

/**
 * Memory retrieval surface (consumption path, criterion #10).
 *
 * Read-only in this phase. Tenant scoping is enforced inside the service via
 * withTenant + RLS, so the controller does not need to pass tenant ids — the
 * TenantContextMiddleware has already set the request scope.
 *
 * GET /memory/items?clientId=&type=   -> items the caller may see
 * GET /memory/items/:slug/markdown    -> Obsidian-format projection (added in
 *                                          the editing phase)
 */
@Controller('memory')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class MemoryController {
  constructor(private readonly store: MemoryStoreService) {}

  @Get('items')
  async listItems(
    @Query('clientId') clientId?: string,
    @Query('type') type?: MemoryItemType,
  ) {
    const items = await this.store.listForCurrentTenant({ clientId, type });
    // Return a compact shape; full markdown is fetched per-item on demand.
    return items.map((i) => ({
      id: i.id,
      type: i.type,
      slug: i.slug,
      title: i.title,
      clientId: i.clientId,
      visibility: i.visibility,
      entityId: i.entityId,
      updatedAt: i.updatedAt,
    }));
  }
}
