import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextStore } from '../tenant/tenant-context.store.js';
import { MemoryStoreService } from './memory-store.service.js';
import { clioMemoryToItem, type ClioMemoryRow, type NameResolver } from './memory-clio-adapter.helpers.js';
import { meetingToItem } from './memory-ingest.helpers.js';
import type { MemoryItem } from './memory.types.js';
import { MEMORY_SCHEMA_VERSION } from './memory.types.js';

/**
 * Backfill / ingestion service (Phases A-C).
 *
 * Idempotent: every item has a stable slug, upsertSystem does ON CONFLICT
 * update, so re-running never duplicates. Each phase reads a source under
 * withSystem (trusted backfill) and projects rows into MemoryItems.
 *
 * Phase A entity nodes (clients/bills/people/issues) are created so the graph
 * has labeled nodes even before they carry narrative; the FK loader supplies
 * the structural edges at query time.
 */
@Injectable()
export class MemoryIngestService {
  private readonly logger = new Logger(MemoryIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: MemoryStoreService,
    private readonly tenantCtx: TenantContextStore,
  ) {}

  /** Run the full backfill for the current tenant. Returns per-phase counts. */
  async backfillCurrentTenant(): Promise<Record<string, number>> {
    const ctx = this.tenantCtx.require();
    const counts: Record<string, number> = { clients: 0, clioMemories: 0, meetings: 0 };

    // ---- Phase A: client entity nodes ----
    const clients = await this.prisma.withSystem((tx) =>
      tx.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, name FROM clients WHERE tenant_id = ${ctx.tenantId}::uuid AND status = 'active'
      `,
    );
    const nameResolver: NameResolver = buildClientNameResolver(clients);
    for (const c of clients) {
      await this.store.upsertSystem(clientToItem(ctx.tenantId, c));
      counts.clients++;
    }

    // ---- Phase B: ClioMemory unification ----
    const memories = await this.prisma.withSystem((tx) =>
      tx.$queryRaw<ClioMemoryRow[]>`
        SELECT id, tenant_id AS "tenantId", scope, owner_user_id AS "ownerUserId",
               key, value, source, metadata_jsonb AS metadata,
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM clio_memory WHERE tenant_id = ${ctx.tenantId}::uuid
      `,
    );
    for (const m of memories) {
      const row: ClioMemoryRow = {
        ...m,
        createdAt: new Date(m.createdAt as unknown as string).toISOString(),
        updatedAt: new Date(m.updatedAt as unknown as string).toISOString(),
      };
      await this.store.upsertSystem(clioMemoryToItem(row, nameResolver));
      counts.clioMemories++;
    }

    // ---- Phase C: meetings (non-internal, client-linked) ----
    const meetings = await this.prisma.withSystem((tx) =>
      tx.$queryRaw<Array<{ id: string; client_id: string; subject: string; starts_at: Date }>>`
        SELECT id, client_id, subject, starts_at
        FROM meetings
        WHERE tenant_id = ${ctx.tenantId}::uuid AND client_id IS NOT NULL AND is_internal = false
      `,
    );
    for (const mt of meetings) {
      const date = new Date(mt.starts_at).toISOString().slice(0, 10);
      // Debrief bodies are encrypted and intentionally NOT decrypted here; we
      // record the meeting node + its prep slot only.
      await this.store.upsertSystem(
        meetingToItem({
          tenantId: ctx.tenantId,
          meetingId: mt.id,
          clientId: mt.client_id,
          title: mt.subject || 'Meeting',
          date,
          prep: '_Linked from engagement calendar._',
          wikilinks: [`[[client:${mt.client_id}]]`],
        }),
      );
      counts.meetings++;
    }

    this.logger.log(`backfill tenant=${ctx.tenantId} ${JSON.stringify(counts)}`);
    return counts;
  }
}

function clientToItem(tenantId: string, c: { id: string; name: string }): MemoryItem {
  const ts = new Date().toISOString();
  return {
    id: '', tenantId, clientId: c.id, ownerUserId: null,
    type: 'client-hub', visibility: 'tenant', entityId: c.id,
    slug: c.id, title: c.name, aliases: [], tags: ['client'],
    source: 'ingest', sourceRef: c.id, provenance: `ingest@${MEMORY_SCHEMA_VERSION}`,
    sections: [{ key: 'overview', heading: 'Overview', owner: 'engine', body: `Client: ${c.name}.` }],
    createdAt: ts, updatedAt: ts, schemaVersion: MEMORY_SCHEMA_VERSION,
  };
}

/** Resolver matching memory-text names to client nodes (exact, case-insensitive). */
function buildClientNameResolver(clients: Array<{ id: string; name: string }>): NameResolver {
  const byName = new Map<string, string>();
  for (const c of clients) byName.set(c.name.toLowerCase(), c.id);
  return (name: string) => {
    const id = byName.get(name.toLowerCase());
    return id ? { type: 'client', slug: id } : null;
  };
}
