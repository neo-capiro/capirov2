import { Module } from '@nestjs/common';
import { ProgramElementController } from './program-element.controller.js';
import { ProgramElementReadService } from './program-element-read.service.js';
import { ProgramElementWriterService } from './program-element-writer.service.js';

@Module({
  controllers: [ProgramElementController],
  providers: [ProgramElementReadService, ProgramElementWriterService],
  exports: [ProgramElementWriterService, ProgramElementReadService],
})
export class ProgramElementModule {}
