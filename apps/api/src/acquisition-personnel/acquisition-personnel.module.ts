import { Module } from '@nestjs/common';
import { AcquisitionPersonnelWriterService } from './acquisition-personnel-writer.service.js';
import { AcquisitionPersonnelReadService } from './acquisition-personnel-read.service.js';
import { AcquisitionPersonnelController } from './acquisition-personnel.controller.js';
import { MatchScorerService } from './matching/match-scorer.service.js';

@Module({
  controllers: [AcquisitionPersonnelController],
  providers: [AcquisitionPersonnelWriterService, AcquisitionPersonnelReadService, MatchScorerService],
  exports: [AcquisitionPersonnelWriterService, AcquisitionPersonnelReadService, MatchScorerService],
})
export class AcquisitionPersonnelModule {}
