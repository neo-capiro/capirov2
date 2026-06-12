import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { EngagementModule } from '../engagement/engagement.module.js';
import { AiUsageService } from './ai-usage.service.js';
import { AiCredentialStoreService } from './ai-credential-store.service.js';
import { AiUsageController } from './ai-usage.controller.js';

@Module({
  imports: [PrismaModule, EngagementModule],
  controllers: [AiUsageController],
  providers: [AiUsageService, AiCredentialStoreService],
  exports: [AiUsageService, AiCredentialStoreService],
})
export class AiUsageModule {}
