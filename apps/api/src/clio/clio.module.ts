import { Module } from '@nestjs/common';
import { EngagementModule } from '../engagement/engagement.module.js';
import { ClioController, ClioRuntimeController } from './clio.controller.js';
import { ClioService } from './clio.service.js';
import { ClioToolsService } from './clio-tools.service.js';

@Module({
  imports: [EngagementModule],
  controllers: [ClioController, ClioRuntimeController],
  providers: [ClioService, ClioToolsService],
})
export class ClioModule {}
