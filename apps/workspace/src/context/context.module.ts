import { Module } from '@nestjs/common';
import { ContextController, DraftContextController } from './context.controller.js';
import { ContextService } from './context.service.js';

@Module({
  controllers: [ContextController, DraftContextController],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
