import { Module } from '@nestjs/common';
import { LobbyIntelController } from './lobby-intel.controller.js';
import { LobbyIntelService } from './lobby-intel.service.js';

@Module({
  controllers: [LobbyIntelController],
  providers: [LobbyIntelService],
  exports: [LobbyIntelService],
})
export class LobbyIntelModule {}
