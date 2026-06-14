import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { AppConfig } from '../config/config.schema.js';

/**
 * Thin wrapper around the Stripe SDK. Constructs a single client from
 * STRIPE_SECRET_KEY and exposes it to the billing services.
 *
 * Fail-soft: when the key is unset (non-prod / billing not yet wired) the
 * client is null and {@link enabled} is false — callers either skip work
 * (webhook, overage job) or surface a clean 503 via {@link require}. This
 * mirrors the BYO AI-key pattern where the feature is simply inactive until a
 * secret is provided, so the app still boots everywhere.
 *
 * We intentionally do NOT pin `apiVersion` in code: the installed SDK's typed
 * default tracks the account's dashboard API version, which avoids a literal
 * type mismatch on upgrade and keeps a single source of truth in the Stripe
 * dashboard.
 */
@Injectable()
export class StripeClient {
  private readonly logger = new Logger(StripeClient.name);
  readonly client: Stripe | null;

  constructor(config: ConfigService<AppConfig, true>) {
    const key = config.get('STRIPE_SECRET_KEY', { infer: true });
    if (!key) {
      this.logger.warn(
        'STRIPE_SECRET_KEY is unset — billing is INACTIVE (checkout/portal/overage no-op until configured).',
      );
      this.client = null;
      return;
    }
    this.client = new Stripe(key, {
      appInfo: { name: 'Capiro', url: 'https://capiro.ai' },
      // Two automatic retries on network/5xx with idempotency keys the SDK
      // attaches per-request — safe for the create calls we make.
      maxNetworkRetries: 2,
    });
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Returns the client or throws a clean 503 when billing isn't configured. */
  require(): Stripe {
    if (!this.client) {
      throw new ServiceUnavailableException('Billing is not configured on this environment.');
    }
    return this.client;
  }
}
