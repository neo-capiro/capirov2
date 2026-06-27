import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { LobbyIntelModule } from '../lobby-intel/lobby-intel.module.js';
import { FederalSpendingModule } from '../federal-spending/federal-spending.module.js';
import { LdaIntelModule } from '../lda-intel/lda-intel.module.js';
import { EngagementModule } from '../engagement/engagement.module.js';
import { WorkflowsModule } from '../workflows/workflows.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { ChatToolsService } from './chat-tools.service.js';

@Module({
  imports: [
    PrismaModule,
    LobbyIntelModule,
    FederalSpendingModule,
    LdaIntelModule,
    EngagementModule,
    WorkflowsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatToolsService],
})
export class ChatModule {}
