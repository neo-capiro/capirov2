import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DirectoryModule } from '../directory/directory.module.js';
import { EngagementController } from './engagement.controller.js';
import { ClientAssociationService } from './client-association.service.js';
import { EngagementAiService } from './engagement-ai.service.js';
import { EngagementService } from './engagement.service.js';
import { MeetingNotesCryptoService } from './meeting-notes-crypto.service.js';
import { MicrosoftGraphSyncService } from './microsoft/microsoft-graph-sync.service.js';
import { MicrosoftOAuthController } from './microsoft/microsoft-oauth.controller.js';
import { MicrosoftOAuthService } from './microsoft/microsoft-oauth.service.js';
import { TokenCryptoService } from './microsoft/token-crypto.service.js';

@Module({
  imports: [PrismaModule, DirectoryModule],
  controllers: [EngagementController, MicrosoftOAuthController],
  providers: [
    EngagementService,
    ClientAssociationService,
    EngagementAiService,
    MeetingNotesCryptoService,
    MicrosoftGraphSyncService,
    MicrosoftOAuthService,
    TokenCryptoService,
  ],
})
export class EngagementModule {}
