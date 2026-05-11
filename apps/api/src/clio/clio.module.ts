import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { ClioRuntimeClient } from './clio-runtime.client.js';
import { ClioController } from './clio.controller.js';
import { ClioService } from './clio.service.js';
import { ClioInternalAuthGuard } from './internal/clio-internal.guard.js';
import { ClioInternalController } from './internal/clio-internal.controller.js';
import { GetClientContextTool } from './tools/get-client-context.tool.js';
import { ToolRegistryService } from './tools/tool-registry.service.js';

@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [ClioController, ClioInternalController],
  providers: [
    ClioService,
    ClioRuntimeClient,
    ClioInternalAuthGuard,
    GetClientContextTool,
    ToolRegistryService,
  ],
  exports: [ClioService, ToolRegistryService],
})
export class ClioModule {}
