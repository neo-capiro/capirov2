import { Module } from '@nestjs/common';
import { ProgramElementController } from './program-element.controller.js';
import { ProgramElementReadService } from './program-element-read.service.js';
import { ProgramElementWriterService } from './program-element-writer.service.js';
import { ConferenceProbabilityService } from './models/conference-probability.service.js';
import { ProgramElementMetricsService } from './program-element-metrics.service.js';
import { ReconciliationService } from './reconciliation/reconciliation.service.js';

@Module({
  controllers: [ProgramElementController],
  providers: [
    ProgramElementReadService,
    ProgramElementWriterService,
    ConferenceProbabilityService,
    ProgramElementMetricsService,
    ReconciliationService,
  ],
  exports: [ProgramElementWriterService, ProgramElementReadService, ConferenceProbabilityService],
})
export class ProgramElementModule {}
