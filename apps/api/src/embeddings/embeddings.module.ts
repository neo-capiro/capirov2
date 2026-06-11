import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service.js';
import { ClientKbService } from './client-kb.service.js';

/**
 * Embeddings module, provides EmbeddingsService for on-write hooks in
 * write-path modules (ClientsModule for capability create/update) and
 * ClientKbService — the client knowledge-base indexer/retriever (F5) — for
 * lifecycle hooks (clients, engagement) and Clio retrieval.
 *
 * Imports nothing because PrismaService is exposed globally by PrismaModule
 * in AppModule. Exports the services so other feature modules can inject them.
 */
@Module({
  providers: [EmbeddingsService, ClientKbService],
  exports: [EmbeddingsService, ClientKbService],
})
export class EmbeddingsModule {}
