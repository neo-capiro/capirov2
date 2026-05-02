import { Module } from '@nestjs/common';
import { CapiroAdminController } from './capiro-admin.controller.js';
import { CapiroAdminService } from './capiro-admin.service.js';

@Module({
  controllers: [CapiroAdminController],
  providers: [CapiroAdminService],
})
export class CapiroAdminModule {}
