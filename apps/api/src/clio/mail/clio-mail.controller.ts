import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { IsOptional, IsString } from 'class-validator';
import type { AppConfig } from '../../config/config.schema.js';
import { ClioMailService } from './clio-mail.service.js';

/**
 * Inbound mail webhook. Called by the AWS Lambda that consumes SES
 * receipt events for the clio.capiro.ai domain. The Lambda parses
 * the raw MIME blob in S3, then POSTs a JSON envelope here.
 *
 * Auth: the Lambda HMAC-SHA256-signs the request body with the
 * `CLIO_MAIL_WEBHOOK_SECRET` shared secret and sends the hex digest
 * in `X-Clio-Mail-Signature`. We verify in constant time and fail
 * closed when the secret isn't configured (no inbound mail accepted
 * until ops has wired the secret).
 *
 * The route is excluded from the tenant-context middleware (it's not
 * a Clerk-authenticated request) — the tenant is *resolved* from the
 * recipient address via ClioMailbox lookup.
 */
class WebhookBody {
  @IsString()
  sesMessageId!: string;
  @IsString()
  rawS3Key!: string;
  @IsString()
  toAddress!: string;
  @IsString()
  fromAddress!: string;
  @IsOptional()
  @IsString()
  fromName?: string;
  @IsString()
  subject!: string;
  @IsOptional()
  @IsString()
  bodyText?: string;
  @IsOptional()
  @IsString()
  bodyHtml?: string;
}

@Controller('webhooks/clio-mail')
export class ClioMailController {
  private readonly logger = new Logger(ClioMailController.name);

  constructor(
    private readonly mail: ClioMailService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Post()
  @HttpCode(202)
  async receive(
    @Headers('x-clio-mail-signature') signature: string | undefined,
    @Body() body: WebhookBody,
  ): Promise<{ ok: boolean; id?: string; status: string }> {
    const secret = this.config.get('CLIO_MAIL_WEBHOOK_SECRET', { infer: true }) ?? '';
    if (!secret) {
      this.logger.warn('Inbound mail rejected: CLIO_MAIL_WEBHOOK_SECRET not configured');
      throw new UnauthorizedException();
    }
    if (!signature) {
      throw new UnauthorizedException();
    }
    const expected = createHmac('sha256', secret)
      .update(JSON.stringify(body))
      .digest('hex');
    const provided = signature.trim();
    if (provided.length !== expected.length) {
      throw new UnauthorizedException();
    }
    try {
      if (!timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
        throw new UnauthorizedException();
      }
    } catch {
      throw new UnauthorizedException();
    }

    // Best-effort validation of essential fields beyond class-validator —
    // toAddress must look like an email.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.toAddress)) {
      throw new BadRequestException('toAddress must be an email');
    }

    const row = await this.mail.recordInbound({
      sesMessageId: body.sesMessageId,
      rawS3Key: body.rawS3Key,
      toAddress: body.toAddress,
      fromAddress: body.fromAddress,
      ...(body.fromName ? { fromName: body.fromName } : {}),
      subject: body.subject,
      ...(body.bodyText ? { bodyText: body.bodyText } : {}),
      ...(body.bodyHtml ? { bodyHtml: body.bodyHtml } : {}),
    });
    if (!row) {
      // Unknown mailbox — Lambda still gets a 202 so it doesn't retry
      // indefinitely. We log the miss and drop the message.
      this.logger.warn(`Dropped inbound to unknown mailbox: ${body.toAddress}`);
      return { ok: true, status: 'dropped-unknown-mailbox' };
    }
    this.logger.log(
      `Inbound mail recorded id=${row.id} to=${row.toAddress} ses=${row.sesMessageId}`,
    );
    // TODO (next session): spawn or append to a ClioSession for the
    // recipient user. For now we just record the row; the Workspace
    // UI can surface "you have N pending inbound" and the user can
    // click in to trigger Clio.
    return { ok: true, id: row.id, status: 'recorded' };
  }
}
