import { Module } from '@nestjs/common';
import { LdaIntelController } from './lda-intel.controller.js';
import { LdaIntelService } from './lda-intel.service.js';

@Module({
  controllers: [LdaIntelController],
  providers: [LdaIntelService],
  exports: [LdaIntelService],
})
export class LdaIntelModule {}
