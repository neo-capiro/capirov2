import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { TenantModule } from '../../tenant/tenant.module.js';
import { RenderArtifactTool } from '../tools/render-artifact.tool.js';
import { ClioArtifactsController } from './artifacts.controller.js';
import { RendererService } from './renderer.service.js';

@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [ClioArtifactsController],
  providers: [RendererService, RenderArtifactTool],
  exports: [RendererService, RenderArtifactTool],
})
export class ClioArtifactsModule {}
