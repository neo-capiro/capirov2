import { Module } from '@nestjs/common';
import { GenerationController } from './generation.controller.js';
import { GenerationService } from './generation.service.js';
import { AiCredentialService } from './ai-credential.service.js';

@Module({
  controllers: [GenerationController],
  providers: [GenerationService, AiCredentialService],
  exports: [GenerationService, AiCredentialService],
})
export class GenerationModule {}
