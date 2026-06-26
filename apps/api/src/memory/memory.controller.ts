import { Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { MemoryStoreService } from './memory-store.service.js';
import { MemoryFkLoader } from './memory-fk-loader.service.js';
import { MemoryIngestService } from './memory-ingest.service.js';
import type { MemoryItemType } from './memory.types.js';
import { buildKnowledgeGraph, walkFrom } from './memory-graph.helpers.js';

/**
 * Memory retrieval + knowledge-graph surface.
 *
 * Read endpoints scope via withTenant + RLS (caller's tenant only, plus their
 * own private items). The graph merges authoritative DB foreign keys (from
 * MemoryFkLoader, origin='fk') with analyst wikilink edges (origin='mention').
 *
 * Routes:
 *   GET  /memory/items                      list items the caller may see
 *   GET  /memory/items/:type/:slug/markdown Obsidian-format projection
 *   GET  /memory/graph[?seed=&depth=]       full graph or a focused walk
 *   GET  /memory/graph/client/:clientId     per-client subgraph (view #1)
 *   GET  /memory/graph/path?to=office:<id>  shortest paths to a target (view #2)
 *   POST /memory/backfill                    (admin) populate from DB sources
 */
@Controller('memory')
@UseGuards(RolesGuard)
@Roles('standard_user')
export class MemoryController {
  constructor(
    private readonly store: MemoryStoreService,
    private readonly fkLoader: MemoryFkLoader,
    private readonly ingest: MemoryIngestService,
  ) {}

  @Get('items')
  async listItems(
    @Query('clientId') clientId?: string,
    @Query('type') type?: MemoryItemType,
  ) {
    const items = await this.store.listForCurrentTenant({ clientId, type });
    return items.map((i) => ({
      id: i.id, type: i.type, slug: i.slug, title: i.title,
      clientId: i.clientId, visibility: i.visibility, entityId: i.entityId, updatedAt: i.updatedAt,
    }));
  }

  @Get('items/:type/:slug/markdown')
  async itemMarkdown(@Param('type') type: MemoryItemType, @Param('slug') slug: string) {
    const item = await this.store.getByTypeSlug(type, slug);
    if (!item) throw new NotFoundException('memory item not found');
    return this.store.project(item);
  }

  /** Full knowledge graph, or a depth-bounded walk from `seed`. */
  @Get('graph')
  async graph(@Query('seed') seed?: string, @Query('depth') depth?: string) {
    const full = await this.buildFullGraph();
    if (seed) {
      return walkFrom(full, seed, depth ? Math.max(1, parseInt(depth, 10) || 1) : 2);
    }
    return full;
  }

  /** View #1: per-client subgraph — everything within `depth` hops of a client. */
  @Get('graph/client/:clientId')
  async clientGraph(@Param('clientId') clientId: string, @Query('depth') depth?: string) {
    const full = await this.buildFullGraph();
    return walkFrom(full, `client:${clientId}`, depth ? Math.max(1, parseInt(depth, 10) || 1) : 2);
  }

  /**
   * View #2: "find a path to this entity" — returns the subgraph around the
   * target plus the set of shortest paths from each client to it, so a
   * lobbyist sees the warm route ("who do we already know near this office?").
   */
  @Get('graph/path')
  async pathTo(@Query('to') to?: string, @Query('depth') depth?: string) {
    if (!to) return { nodes: [], edges: [], paths: [] };
    const full = await this.buildFullGraph();
    const sub = walkFrom(full, to, depth ? Math.max(1, parseInt(depth, 10) || 1) : 3);
    const clients = sub.nodes.filter((n) => n.type === 'client').map((n) => n.id);
    const paths = clients
      .map((c) => shortestPath(full, c, to))
      .filter((p): p is string[] => p !== null);
    return { ...sub, paths };
  }

  /** Admin: populate the graph from DB sources (clients, ClioMemory, meetings). */
  @Post('backfill')
  @Roles('user_admin')
  async backfill() {
    const counts = await this.ingest.backfillCurrentTenant();
    return { ok: true, counts };
  }

  private async buildFullGraph() {
    const [{ wikiEdges, itemNodes }, fkRelations] = await Promise.all([
      this.store.loadGraphInputs(),
      this.fkLoader.loadForCurrentTenant(),
    ]);
    const itemNodeById = new Map(
      itemNodes.map((n) => [n.itemId, { type: n.type, slug: n.slug, label: n.label }]),
    );
    return buildKnowledgeGraph(fkRelations, wikiEdges, itemNodeById);
  }
}

/** BFS shortest path between two node ids over the undirected graph. */
function shortestPath(
  graph: { nodes: Array<{ id: string }>; edges: Array<{ src: string; dst: string }> },
  from: string,
  to: string,
): string[] | null {
  if (from === to) return [from];
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    (adj.get(e.src) ?? adj.set(e.src, []).get(e.src)!).push(e.dst);
    (adj.get(e.dst) ?? adj.set(e.dst, []).get(e.dst)!).push(e.src);
  }
  const prev = new Map<string, string>();
  const visited = new Set<string>([from]);
  let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        prev.set(nb, id);
        if (nb === to) {
          const path = [nb];
          let cur = nb;
          while (prev.has(cur)) { cur = prev.get(cur)!; path.unshift(cur); }
          return path;
        }
        next.push(nb);
      }
    }
    frontier = next;
  }
  return null;
}
