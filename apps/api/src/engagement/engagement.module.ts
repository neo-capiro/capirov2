import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { EngagementController } from './engagement.controller.js';
import { ClientAssociationService } from './client-association.service.js';
import { EngagementAiService } from './engagement-ai.service.js';
import { EngagementService } from './engagement.service.js';
import { MeetingNotesCryptoService } from './meeting-notes-crypto.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [EngagementController],
  providers: [
    EngagementService,
    ClientAssociationService,
    EngagementAiService,
    MeetingNotesCryptoService,
  ],
})
export class EngagementModule {}
