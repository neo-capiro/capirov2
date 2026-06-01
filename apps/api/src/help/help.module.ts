import { Module } from '@nestjs/common';
import { HelpController } from './help.controller.js';
import { HelpService } from './help.service.js';

@Module({
  controllers: [HelpController],
  providers: [HelpService],
})
export class HelpModule {}
