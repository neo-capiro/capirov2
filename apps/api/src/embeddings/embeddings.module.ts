import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service.js';

/**
 * Embeddings module, provides EmbeddingsService for on-write hooks in
 * write-path modules (ClientsModule for capability create/update).
 *
 * Imports nothing because PrismaService is exposed globally by PrismaModule
 * in AppModule. Exports the service so other feature modules can inject it.
 */
@Module({
  providers: [EmbeddingsService],
  exports: [EmbeddingsService],
})
export class EmbeddingsModule {}
