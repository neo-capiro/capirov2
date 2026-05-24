import { Module } from '@nestjs/common';
import { IntelligenceController } from './intelligence.controller.js';
import { IntelligenceService } from './intelligence.service.js';
import { InsightGeneratorService } from './insight-generator.service.js';
import { EntityResolutionService } from './entity-resolution.service.js';
import { ReportCardService } from './report-card.service.js';
import { LdaIntelModule } from '../lda-intel/lda-intel.module.js';
import { LobbyIntelModule } from '../lobby-intel/lobby-intel.module.js';
import { FederalSpendingModule } from '../federal-spending/federal-spending.module.js';
import { FederalRegisterModule } from '../federal-register/federal-register.module.js';

@Module({
  imports: [LdaIntelModule, LobbyIntelModule, FederalSpendingModule, FederalRegisterModule],
  controllers: [IntelligenceController],
  providers: [IntelligenceService, InsightGeneratorService, EntityResolutionService, ReportCardService],
  exports: [IntelligenceService, InsightGeneratorService, EntityResolutionService, ReportCardService],
})
export class IntelligenceModule {}
