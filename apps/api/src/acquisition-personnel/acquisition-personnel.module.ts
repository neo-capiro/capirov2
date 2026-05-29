import { Module } from '@nestjs/common';
import { AcquisitionPersonnelWriterService } from './acquisition-personnel-writer.service.js';
import { MatchScorerService } from './matching/match-scorer.service.js';

@Module({
  providers: [AcquisitionPersonnelWriterService, MatchScorerService],
  exports: [AcquisitionPersonnelWriterService, MatchScorerService],
})
export class AcquisitionPersonnelModule {}
