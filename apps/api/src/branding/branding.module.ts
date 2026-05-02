import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller.js';
import { BrandingService } from './branding.service.js';

@Module({
  controllers: [BrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
