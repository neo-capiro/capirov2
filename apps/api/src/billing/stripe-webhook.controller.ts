import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type Stripe from 'stripe';
import type { AppConfig } from '../config/config.schema.js';
import { StripeClient } from './stripe.client.js';
import { StripeWebhookService } from './stripe-webhook.service.js';

/**
 * Stripe webhook receiver. Endpoint registered in the Stripe dashboard:
 *   https://app.capiro.ai/webhooks/stripe
 *
 * Signature verification uses the Stripe SDK against STRIPE_WEBHOOK_SECRET. The
 * raw body is required, main.ts mounts the `raw()` parser on this exact path
 * (alongside /webhooks/clerk). When billing is not configured on the env, the
 * endpoint accepts and ignores deliveries (204) so health/probes never error.
 */
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);
  private readonly secret?: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly stripe: StripeClient,
    private readonly service: StripeWebhookService,
  ) {
    this.secret = config.get('STRIPE_WEBHOOK_SECRET', { infer: true });
  }

  @Post()
  @HttpCode(204)
  async receive(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<void> {
    if (!this.stripe.enabled || !this.secret) {
      this.logger.warn('Received Stripe webhook but billing is not configured — ignoring.');
      return;
    }
    if (!signature) throw new BadRequestException('Missing stripe-signature header');

    // main.ts mounts raw() on this path, so req.body is a Buffer.
    const raw = (req as unknown as { body: Buffer }).body;
    if (!Buffer.isBuffer(raw)) throw new BadRequestException('Expected raw body');

    let event: Stripe.Event;
    try {
      event = this.stripe.require().webhooks.constructEvent(raw, signature, this.secret);
    } catch (err) {
      this.logger.warn(`Stripe webhook signature verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    await this.service.handle(event);
  }
}
