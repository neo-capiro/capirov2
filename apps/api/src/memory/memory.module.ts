import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { MemoryStoreService } from './memory-store.service.js';
import { MemoryInterviewService } from './memory-interview.service.js';
import { MemoryController } from './memory.controller.js';

/**
 * Institutional Memory module (plan §0.5).
 *
 * Provides the canonical memory store + the retrieval/editing surface the AI,
 * the Intelligence Center, and the Settings "Memory" tab consume. The interview
 * service drafts section text from Q&A answers (graceful LLM fallback).
 *
 * NOTE: ingestion workers (Graph email / Meri / meetings) are a separate,
 * approval-gated phase (Neo EMAIL guardrail) and are NOT wired here.
 */
@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [MemoryController],
  providers: [MemoryStoreService, MemoryInterviewService],
  exports: [MemoryStoreService],
})
export class MemoryModule {}
