import { Module } from '@nestjs/common';
import { RegulatoryDocketController } from './regulatory-docket.controller.js';
import { RegulatoryDocketService } from './regulatory-docket.service.js';

@Module({
  controllers: [RegulatoryDocketController],
  providers: [RegulatoryDocketService],
  exports: [RegulatoryDocketService],
})
export class RegulatoryDocketModule {}
