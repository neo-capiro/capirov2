import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { MemoryStoreService } from './memory-store.service.js';
import { MemoryController } from './memory.controller.js';

/**
 * Institutional Memory module (plan §0.5).
 *
 * Provides the canonical memory store + the retrieval surface the AI and
 * Intelligence Center consume. Exported so Meri (get_client_context-style
 * tools) and meeting-prep can read memory at runtime (criterion #10).
 *
 * NOTE: ingestion workers (Graph email / Meri / meetings) are a separate,
 * approval-gated phase (Neo EMAIL guardrail) and are NOT wired here.
 */
@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [MemoryController],
  providers: [MemoryStoreService],
  exports: [MemoryStoreService],
})
export class MemoryModule {}
