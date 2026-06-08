import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WorkflowsController } from './workflows.controller.js';
import { WorkflowsService } from './workflows.service.js';
import { WhitePaperService } from './whitepaper.service.js';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WhitePaperService],
  exports: [WorkflowsService, WhitePaperService],
})
export class WorkflowsModule {}
