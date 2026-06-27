import { Module } from '@nestjs/common';
import { GenerationController, MeriIntakeController } from './generation.controller.js';
import { GenerationService } from './generation.service.js';
import { AiCredentialService } from './ai-credential.service.js';

@Module({
  controllers: [GenerationController, MeriIntakeController],
  providers: [GenerationService, AiCredentialService],
  exports: [GenerationService, AiCredentialService],
})
export class GenerationModule {}
