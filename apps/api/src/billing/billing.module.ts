import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AiUsageModule } from '../ai-usage/ai-usage.module.js';
import { StripeClient } from './stripe.client.js';
import { BillingService } from './billing.service.js';
import { BillingController } from './billing.controller.js';
import { StripeWebhookService } from './stripe-webhook.service.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';
import { BillingOverageService } from './billing-overage.service.js';

/**
 * Stripe-direct billing: Checkout + Customer Portal + webhook sync, plus the
 * LLM-overage metering service used by the report-llm-overage job. Imports
 * AiUsageModule for the usage aggregator that backs the LLM allowance/overage
 * math. Exports BillingService + BillingOverageService so the capiro-admin
 * console (customers list / comp) and the scheduled job can reuse them.
 */
@Module({
  imports: [PrismaModule, AiUsageModule],
  controllers: [BillingController, StripeWebhookController],
  providers: [StripeClient, BillingService, StripeWebhookService, BillingOverageService],
  exports: [BillingService, BillingOverageService, StripeClient],
})
export class BillingModule {}
