import { Module } from '@nestjs/common';
import { EngagementModule } from '../engagement/engagement.module.js';
import { LdaIntelModule } from '../lda-intel/lda-intel.module.js';
import { LobbyIntelModule } from '../lobby-intel/lobby-intel.module.js';
import { FederalSpendingModule } from '../federal-spending/federal-spending.module.js';
import { ProgramElementModule } from '../program-element/program-element.module.js';
import { AcquisitionPersonnelModule } from '../acquisition-personnel/acquisition-personnel.module.js';
import { WorkflowsModule } from '../workflows/workflows.module.js';
import { StrategiesModule } from '../strategies/strategies.module.js';
import { IntelligenceModule } from '../intelligence/intelligence.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { RegulatoryDocketModule } from '../regulatory-docket/regulatory-docket.module.js';
import { ClioController } from './clio.controller.js';
import { ClioService } from './clio.service.js';
import { ClioToolsService } from './clio-tools.service.js';
import { ClioResearchService } from './clio-research.service.js';
import { ClioDocgenService } from './clio-docgen.service.js';

@Module({
  imports: [
    EngagementModule,
    LdaIntelModule,
    LobbyIntelModule,
    FederalSpendingModule,
    ProgramElementModule,
    AcquisitionPersonnelModule,
    WorkflowsModule,
    StrategiesModule,
    IntelligenceModule,
    ClientsModule,
    RegulatoryDocketModule,
  ],
  controllers: [ClioController],
  providers: [ClioService, ClioToolsService, ClioResearchService, ClioDocgenService],
})
export class ClioModule {}
