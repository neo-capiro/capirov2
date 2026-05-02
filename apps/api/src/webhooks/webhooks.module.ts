import { Module } from '@nestjs/common';
import { ClerkWebhookController } from './clerk-webhook.controller.js';
import { ClerkWebhookService } from './clerk-webhook.service.js';

@Module({
  controllers: [ClerkWebhookController],
  providers: [ClerkWebhookService],
})
export class WebhooksModule {}
