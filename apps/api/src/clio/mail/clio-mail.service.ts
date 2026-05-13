import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/config.schema.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Owns the per-user Clio mailbox lifecycle and the inbound/outbound
 * mail tables.
 *
 * Mailbox addresses are `<localPart>@<domain>` where the domain comes
 * from `CLIO_MAIL_DOMAIN` (e.g. `clio.capiro.ai`). One mailbox per
 * Capiro user; auto-provisioned on first need.
 *
 * Three responsibilities:
 *   - `ensureMailbox(tenantId, userId, hint)` — idempotent provision.
 *   - `recordInbound(...)` — called by the `/webhooks/clio-mail`
 *     route after the Lambda parses an inbound SES delivery.
 *   - `sendEmail(...)` — used by the `send_email` Clio tool. Stub
 *     for now; will wire AWS SES SendEmail once the domain is
 *     verified and the IAM policy is in place.
 *
 * Domain verification, DNS, SES rule set, and the Lambda are
 * deployed via the CDK SES stack (not yet built — see
 * OVERNIGHT_DECISIONS_LOCKED.md §4 deploy plan).
 */
@Injectable()
export class ClioMailService {
  private readonly logger = new Logger(ClioMailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private mailDomain(): string {
    return (
      this.config.get('CLIO_MAIL_DOMAIN', { infer: true }) ?? 'clio.capiro.ai'
    );
  }

  /**
   * Idempotent — returns the existing mailbox row if there is one,
   * otherwise mints a fresh `<slug>@<domain>` address. The hint is
   * used for the *initial* slug; if no hint is passed, the user's
   * own email + first name are looked up. Collisions append a digit
   * suffix (`neo` → `neo2` → `neo3`…).
   */
  async ensureMailbox(
    tenantId: string,
    userId: string,
    hint: { email?: string; firstName?: string } = {},
  ) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.clioMailbox.findUnique({ where: { userId } });
      if (existing) return existing;

      // Resolve email + first name from the user row when the caller
      // didn't pass them. Critical for getting useful initial slugs —
      // without this we end up with `user@clio.capiro.ai` for every
      // first-time user.
      let finalHint = hint;
      if (!finalHint.email && !finalHint.firstName) {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { email: true, firstName: true },
        });
        if (user) {
          finalHint = {
            email: user.email,
            ...(user.firstName ? { firstName: user.firstName } : {}),
          };
        }
      }

      const desired = pickInitialSlug(finalHint);
      const localPart = await findFreeLocalPart(tx, desired);
      const fullAddress = `${localPart}@${this.mailDomain()}`;
      const row = await tx.clioMailbox.create({
        data: {
          tenantId,
          userId,
          localPart,
          fullAddress,
        },
      });
      this.logger.log(`Provisioned Clio mailbox ${fullAddress} for user ${userId}`);
      return row;
    });
  }

  /** Recent inbound mail for the current user. Newest first, capped at 50. */
  async listInbox(tenantId: string, userId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.clioInboundMail.findMany({
        where: { userId },
        orderBy: { receivedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          fromAddress: true,
          fromName: true,
          subject: true,
          receivedAt: true,
          status: true,
          clioSessionId: true,
        },
      });
      return rows.map((r) => ({
        ...r,
        receivedAt: r.receivedAt.toISOString(),
      }));
    });
  }

  /** Read the current user's mailbox (404 if none yet — caller can
   * choose to ensureMailbox first or surface the empty state). */
  async getMailbox(tenantId: string, userId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.clioMailbox.findUnique({ where: { userId } });
      if (!row) throw new NotFoundException('No Clio mailbox for this user');
      return row;
    });
  }

  /** Toggle auto-reply on/off. */
  async setAutoReply(tenantId: string, userId: string, autoReply: boolean) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.clioMailbox.findUnique({ where: { userId } });
      if (!row) throw new NotFoundException('No Clio mailbox for this user');
      return tx.clioMailbox.update({
        where: { id: row.id },
        data: { autoReply },
      });
    });
  }

  /** Rename — once-only per user (we don't enforce that constraint
   * here; the controller can layer that policy on top). */
  async renameMailbox(tenantId: string, userId: string, newLocalPart: string) {
    const trimmed = newLocalPart.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,40}$/.test(trimmed)) {
      throw new BadRequestException(
        'Slug must be 2-40 chars, lowercase letters/digits/hyphens only',
      );
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existing = await tx.clioMailbox.findUnique({ where: { userId } });
      if (!existing) throw new NotFoundException('No Clio mailbox for this user');
      // Unique check happens at DB level via the unique constraint;
      // we wrap it for a friendlier error.
      const clash = await tx.clioMailbox.findUnique({
        where: { localPart: trimmed },
      });
      if (clash && clash.id !== existing.id) {
        throw new BadRequestException('That address is already taken');
      }
      return tx.clioMailbox.update({
        where: { id: existing.id },
        data: {
          localPart: trimmed,
          fullAddress: `${trimmed}@${this.mailDomain()}`,
        },
      });
    });
  }

  /**
   * Record an inbound email. Called by the `/webhooks/clio-mail`
   * route after the Lambda parses an SES delivery. Returns the
   * persisted row (caller spawns the Clio session next).
   *
   * Idempotent on `sesMessageId` — duplicate webhook deliveries
   * resolve to the same row.
   */
  async recordInbound(input: {
    sesMessageId: string;
    rawS3Key: string;
    toAddress: string;
    fromAddress: string;
    fromName?: string;
    subject: string;
    bodyText?: string;
    bodyHtml?: string;
  }) {
    // Resolve mailbox → tenant + user. Bypass RLS for the lookup
    // because the webhook doesn't have a tenant context yet — we're
    // *resolving* the tenant from the recipient address.
    const mailbox = await this.prisma.withSystem(async (tx) =>
      tx.clioMailbox.findUnique({
        where: { fullAddress: input.toAddress.toLowerCase() },
      }),
    );
    if (!mailbox || !mailbox.active) {
      this.logger.warn(
        `Inbound mail to unknown address: ${input.toAddress} (ses=${input.sesMessageId})`,
      );
      return null;
    }
    return this.prisma.withTenant(mailbox.tenantId, async (tx) => {
      // Upsert by sesMessageId — webhook can fire twice.
      return tx.clioInboundMail.upsert({
        where: { sesMessageId: input.sesMessageId },
        create: {
          tenantId: mailbox.tenantId,
          userId: mailbox.userId,
          mailboxId: mailbox.id,
          sesMessageId: input.sesMessageId,
          rawS3Key: input.rawS3Key,
          toAddress: input.toAddress.toLowerCase(),
          fromAddress: input.fromAddress,
          ...(input.fromName ? { fromName: input.fromName } : {}),
          subject: input.subject || '(no subject)',
          ...(input.bodyText ? { bodyText: input.bodyText } : {}),
          ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
        },
        update: {}, // no-op on duplicate
      });
    });
  }

  /**
   * Send an email on a user's behalf. Stubbed until the SES domain
   * is verified — for now we persist the outbound row with a null
   * `sesMessageId` and return it. The agent loop sees a successful
   * send so it can keep talking to the user; nothing actually leaves
   * the cluster yet.
   *
   * Wire to SES SendEmail in the next session once
   * `CLIO_MAIL_SEND_ENABLED=true` is set on the API task.
   */
  async sendEmail(
    tenantId: string,
    userId: string,
    input: {
      to: string;
      cc?: string;
      subject: string;
      bodyText: string;
      bodyHtml?: string;
      sessionId?: string;
      inReplyToInboundId?: string;
    },
  ) {
    const sendEnabled =
      this.config.get('CLIO_MAIL_SEND_ENABLED', { infer: true }) === 'true';
    return this.prisma.withTenant(tenantId, async (tx) => {
      const mailbox = await tx.clioMailbox.findUnique({ where: { userId } });
      if (!mailbox) {
        throw new NotFoundException(
          'User has no Clio mailbox — provision one first via ensureMailbox',
        );
      }
      // TODO: when sendEnabled, call AWS SES SendEmail here with
      // From: mailbox.fullAddress, capture sesMessageId, populate it
      // on the row below.
      if (!sendEnabled) {
        this.logger.log(
          `[stub] Would send mail from ${mailbox.fullAddress} to ${input.to} (SES not enabled yet)`,
        );
      }
      const row = await tx.clioOutboundMail.create({
        data: {
          tenantId,
          userId,
          mailboxId: mailbox.id,
          toAddress: input.to,
          ...(input.cc ? { ccAddress: input.cc } : {}),
          subject: input.subject,
          bodyText: input.bodyText,
          ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
          ...(input.sessionId ? { clioSessionId: input.sessionId } : {}),
          ...(input.inReplyToInboundId
            ? { inReplyToId: input.inReplyToInboundId }
            : {}),
        },
      });
      return { ...row, sent: sendEnabled };
    });
  }
}

function pickInitialSlug(hint: { email?: string; firstName?: string }): string {
  // Prefer the local-part of the user's email; fall back to first
  // name; final fallback random-ish.
  const fromEmail = hint.email?.split('@')[0];
  const fromName = hint.firstName?.toLowerCase();
  const raw = (fromEmail ?? fromName ?? 'user').toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9-]/g, '').slice(0, 40);
  if (cleaned.length < 2) return `user${Math.floor(Math.random() * 9000) + 1000}`;
  return cleaned;
}

async function findFreeLocalPart(
  tx: { clioMailbox: { findUnique: (args: { where: { localPart: string } }) => Promise<unknown> } },
  desired: string,
): Promise<string> {
  // Probe desired, then desired2, desired3, ... up to 99. After that
  // we punt to a random 4-digit suffix. Globally unique across
  // tenants since the email domain is shared.
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? desired : `${desired}${i + 1}`;
    const clash = await tx.clioMailbox.findUnique({
      where: { localPart: candidate },
    });
    if (!clash) return candidate;
  }
  return `${desired}${Math.floor(Math.random() * 9000) + 1000}`;
}
