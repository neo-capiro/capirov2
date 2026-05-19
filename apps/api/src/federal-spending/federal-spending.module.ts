import { Module } from '@nestjs/common';
import { FederalSpendingController } from './federal-spending.controller.js';
import { FederalSpendingService } from './federal-spending.service.js';

@Module({
  controllers: [FederalSpendingController],
  providers: [FederalSpendingService],
  exports: [FederalSpendingService],
})
export class FederalSpendingModule {}
