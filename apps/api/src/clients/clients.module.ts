import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller.js';
import { ClientsService } from './clients.service.js';
import { ClientCapabilitiesController } from './client-capabilities.controller.js';
import { ClientCapabilitiesService } from './client-capabilities.service.js';
import { ClientPeopleController } from './client-people.controller.js';
import { ClientPeopleService } from './client-people.service.js';
import { EmbeddingsModule } from '../embeddings/embeddings.module.js';

@Module({
  imports: [EmbeddingsModule],
  controllers: [ClientsController, ClientCapabilitiesController, ClientPeopleController],
  providers: [ClientsService, ClientCapabilitiesService, ClientPeopleService],
})
export class ClientsModule {}
