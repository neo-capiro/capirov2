import { Module } from '@nestjs/common';
import { EngagementModule } from '../engagement/engagement.module.js';
import { LdaIntelModule } from '../lda-intel/lda-intel.module.js';
import { LobbyIntelModule } from '../lobby-intel/lobby-intel.module.js';
import { FederalSpendingModule } from '../federal-spending/federal-spending.module.js';
import { ClioController, ClioRuntimeController } from './clio.controller.js';
import { ClioService } from './clio.service.js';
import { ClioToolsService } from './clio-tools.service.js';

@Module({
  imports: [EngagementModule, LdaIntelModule, LobbyIntelModule, FederalSpendingModule],
  controllers: [ClioController, ClioRuntimeController],
  providers: [ClioService, ClioToolsService],
})
export class ClioModule {}
