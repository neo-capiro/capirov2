import { Module } from '@nestjs/common';
import { ProgramElementController } from './program-element.controller.js';
import { ProgramElementReadService } from './program-element-read.service.js';
import { ProgramElementWriterService } from './program-element-writer.service.js';
import { ConferenceProbabilityService } from './models/conference-probability.service.js';
import { ProgramElementMetricsService } from './program-element-metrics.service.js';
import { ReconciliationService } from './reconciliation/reconciliation.service.js';
import { ProgramsController } from './programs/programs.controller.js';
import { ProgramsService } from './programs/programs.service.js';
import { PeProgramMatcherService } from './matching/pe-program-matcher.service.js';

@Module({
  controllers: [ProgramElementController, ProgramsController],
  providers: [
    ProgramElementReadService,
    ProgramElementWriterService,
    ConferenceProbabilityService,
    ProgramElementMetricsService,
    ReconciliationService,
    ProgramsService,
    PeProgramMatcherService,
  ],
  exports: [ProgramElementWriterService, ProgramElementReadService, ConferenceProbabilityService, ProgramsService],
})
export class ProgramElementModule {}
