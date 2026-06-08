import { Module } from '@nestjs/common';
import { CapiroAdminController } from './capiro-admin.controller.js';
import { CapiroAdminService } from './capiro-admin.service.js';
import { ProgramElementModule } from '../program-element/program-element.module.js';
import { AcquisitionPersonnelModule } from '../acquisition-personnel/acquisition-personnel.module.js';

@Module({
  // ProgramElementModule + AcquisitionPersonnelModule export their writer
  // services; the quarantine reprocess path reuses the writers' validate+write
  // entry points (Step 3.5) rather than duplicating ingestion logic.
  imports: [ProgramElementModule, AcquisitionPersonnelModule],
  controllers: [CapiroAdminController],
  providers: [CapiroAdminService],
})
export class CapiroAdminModule {}
