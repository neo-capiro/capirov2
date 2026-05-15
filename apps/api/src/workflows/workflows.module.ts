import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WorkflowsController } from './workflows.controller.js';
import { WorkflowsService } from './workflows.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
