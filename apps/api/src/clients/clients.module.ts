import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller.js';
import { ClientsService } from './clients.service.js';
import { ClientCapabilitiesController } from './client-capabilities.controller.js';
import { ClientCapabilitiesService } from './client-capabilities.service.js';
import { ClientPeopleController } from './client-people.controller.js';
import { ClientPeopleService } from './client-people.service.js';
import { ClientFacilitiesController } from './client-facilities.controller.js';
import { ClientFacilitiesService } from './client-facilities.service.js';
import { EmbeddingsModule } from '../embeddings/embeddings.module.js';
import { IntelligenceModule } from '../intelligence/intelligence.module.js';

@Module({
  imports: [EmbeddingsModule, IntelligenceModule],
  controllers: [
    ClientsController,
    ClientCapabilitiesController,
    ClientPeopleController,
    ClientFacilitiesController,
  ],
  providers: [
    ClientsService,
    ClientCapabilitiesService,
    ClientPeopleService,
    ClientFacilitiesService,
  ],
})
export class ClientsModule {}
