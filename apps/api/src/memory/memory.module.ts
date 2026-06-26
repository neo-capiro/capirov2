import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { MemoryStoreService } from './memory-store.service.js';
import { MemoryFkLoader } from './memory-fk-loader.service.js';
import { MemoryIngestService } from './memory-ingest.service.js';
import { MemoryController } from './memory.controller.js';

/**
 * Institutional Memory module.
 *
 * Provides the canonical memory store, the FK loader + ingestion/backfill
 * services, and the retrieval + knowledge-graph surface the AI and the
 * Intelligence "Knowledge Graph" tab consume. Exported so Meri and meeting-prep
 * can read memory at runtime.
 *
 * Ingestion currently covers Phase A (structured entities), B (ClioMemory
 * unification), and C (meetings). Email (Graph) ingestion remains gated behind
 * the EMAIL guardrail and is not wired here.
 */
@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [MemoryController],
  providers: [MemoryStoreService, MemoryFkLoader, MemoryIngestService],
  exports: [MemoryStoreService, MemoryIngestService],
})
export class MemoryModule {}
