import { Module } from '@nestjs/common';
import { FederalRegisterController } from './federal-register.controller.js';
import { FederalRegisterService } from './federal-register.service.js';

@Module({
  controllers: [FederalRegisterController],
  providers: [FederalRegisterService],
  exports: [FederalRegisterService],
})
export class FederalRegisterModule {}
