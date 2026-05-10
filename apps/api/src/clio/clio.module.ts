import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { ClioRuntimeClient } from './clio-runtime.client.js';
import { ClioController } from './clio.controller.js';
import { ClioService } from './clio.service.js';

@Module({
  imports: [PrismaModule, TenantModule],
  controllers: [ClioController],
  providers: [ClioService, ClioRuntimeClient],
  exports: [ClioService],
})
export class ClioModule {}
