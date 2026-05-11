import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { RenderArtifactTool } from '../tools/render-artifact.tool.js';
import { RendererService } from './renderer.service.js';

@Module({
  imports: [PrismaModule],
  providers: [RendererService, RenderArtifactTool],
  exports: [RendererService, RenderArtifactTool],
})
export class ClioArtifactsModule {}
