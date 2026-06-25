import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { MemoryStoreService } from './memory-store.service.js';
import type { MemoryItemType } from './memory.types.js';
import { buildKnowledgeGraph, walkFrom, type FkRelation } from './memory-graph.helpers.js';

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

  /** Obsidian-format markdown projection of one item (human read surface). */
  @Get('items/:type/:slug/markdown')
  async itemMarkdown(
    @Param('type') type: MemoryItemType,
    @Param('slug') slug: string,
  ) {
    const item = await this.store.getByTypeSlug(type, slug);
    if (!item) throw new NotFoundException('memory item not found');
    return this.store.project(item);
  }

  /**
   * Knowledge graph for the Intelligence Center tab (Phase 3, criterion #5).
   * Merges DB FK relations (passed by callers / future FK loader) with the
   * tenant's wikilink edges. `seed` + `depth` optionally return a subgraph
   * answering "history with this entity".
   */
  @Get('graph')
  async graph(
    @Query('seed') seed?: string,
    @Query('depth') depth?: string,
  ) {
    const { wikiEdges, itemNodes } = await this.store.loadGraphInputs();
    const itemNodeById = new Map(
      itemNodes.map((n) => [n.itemId, { type: n.type, slug: n.slug, label: n.label }]),
    );
    // FK relations are supplied by the structured side; empty here until the
    // FK loader (client->bill, person->office, ...) is wired. The merge is
    // already correct and tested with FKs present.
    const fkRelations: FkRelation[] = [];
    const full = buildKnowledgeGraph(fkRelations, wikiEdges, itemNodeById);
    if (seed) {
      return walkFrom(full, seed, depth ? Math.max(1, parseInt(depth, 10) || 1) : 2);
    }
    return full;
  }
}
