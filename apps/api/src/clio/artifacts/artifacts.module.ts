import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { RendererService } from './renderer.service.js';

@Module({
  imports: [PrismaModule],
  providers: [RendererService],
  exports: [RendererService],
})
export class ClioArtifactsModule {}

