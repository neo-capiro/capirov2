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
import { Webhook } from 'svix';
import type { AppConfig } from '../config/config.schema.js';
import { ClerkWebhookService } from './clerk-webhook.service.js';

/**
 * Clerk webhook receiver. Endpoint registered in the Clerk dashboard:
 *   https://api.<env>.capiro.ai/webhooks/clerk
 *
 * Signature verification uses svix. The signing secret comes from the Clerk
 * dashboard (Webhooks -> your endpoint) and lives in the `clerk-webhook-secret`
 * Secrets Manager entry in deployed envs (CLERK_WEBHOOK_SIGNING_SECRET locally).
 *
 * The raw body is required for signature verification, main.ts mounts the
 * `raw()` body parser only on this path.
 */
@Controller('webhooks/clerk')
export class ClerkWebhookController {
  private readonly logger = new Logger(ClerkWebhookController.name);
  private readonly signingSecret: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly service: ClerkWebhookService,
  ) {
    this.signingSecret = config.get('CLERK_WEBHOOK_SIGNING_SECRET', { infer: true });
  }

  @Post()
  @HttpCode(204)
  async receive(
    @Req() req: Request,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
  ): Promise<void> {
    if (!svixId || !svixTimestamp || !svixSignature) {
      throw new BadRequestException('Missing Svix headers');
    }

    // After main.ts mounts `raw()` for this path, req.body is a Buffer.
    const raw = (req as unknown as { body: Buffer }).body;
    if (!Buffer.isBuffer(raw)) {
      throw new BadRequestException('Expected raw body');
    }

    const wh = new Webhook(this.signingSecret);
    let event: { type: string; data: unknown };
    try {
      event = wh.verify(raw.toString('utf8'), {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      }) as { type: string; data: unknown };
    } catch (err) {
      this.logger.warn(`Clerk webhook signature verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    await this.service.handle(svixId, event);
  }
}
