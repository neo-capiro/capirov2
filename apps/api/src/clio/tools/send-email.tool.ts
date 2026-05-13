import { BadRequestException, Injectable } from '@nestjs/common';
import { ClioMailService } from '../mail/clio-mail.service.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

/**
 * Lets the Clio agent send an email on behalf of the current user.
 *
 * From: <user-slug>@clio.capiro.ai (the user's auto-provisioned
 * mailbox). Useful for:
 *   - Replying to an inbound the user CC'd Clio on.
 *   - Following up on a thread the user asked about ("email Sarah
 *     and remind her about Friday").
 *   - Sending Clio-generated artifacts (a draft memo, an Excel) as
 *     an attachment in the body — link form for now until we wire
 *     SES attachment support.
 *
 * Stubbed: while CLIO_MAIL_SEND_ENABLED is unset, the tool persists
 * the outbound row and returns `{sent: false, queued: true, ...}` so
 * the agent can tell the user the email is staged for the next
 * deploy. See OVERNIGHT_DECISIONS_LOCKED.md §4.
 */
@Injectable()
export class SendEmailTool implements Tool {
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'send_email',
    description:
      'Send an email on the user\'s behalf from their Clio mailbox (<slug>@clio.capiro.ai). ' +
      'Use this when the user asks you to "email X" or "follow up with Y" or to reply to an inbound thread. ' +
      'Always confirm the recipient and subject with the user before sending unless they have explicitly told you to send immediately.',
    inputSchema: {
      type: 'object',
      required: ['to', 'subject', 'body'],
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address.',
        },
        cc: {
          type: 'string',
          description: 'Optional CC address.',
        },
        subject: {
          type: 'string',
          description: 'Subject line.',
        },
        body: {
          type: 'string',
          description:
            'Plain-text email body. Markdown will be auto-converted to HTML on send. Keep it concise and professional.',
        },
        inReplyToInboundId: {
          type: 'string',
          description:
            'Optional UUID of a ClioInboundMail row this email is replying to. When set, the outbound is threaded via In-Reply-To: / References: headers.',
        },
      },
    },
  };

  constructor(private readonly mail: ClioMailService) {}

  async execute(rawInput: Record<string, unknown>, ctx: ToolExecutionContext) {
    const to = requiredEmail(rawInput.to, 'to');
    const subject = requiredString(rawInput.subject, 'subject');
    const body = requiredString(rawInput.body, 'body');
    const cc = optionalEmail(rawInput.cc);
    const inReplyToInboundId = optionalUuid(rawInput.inReplyToInboundId);
    const sent = await this.mail.sendEmail(ctx.tenantId, ctx.userId, {
      to,
      subject,
      bodyText: body,
      ...(cc ? { cc } : {}),
      ...(inReplyToInboundId ? { inReplyToInboundId } : {}),
    });
    return {
      ok: true,
      id: sent.id,
      queued: !sent.sent,
      sent: sent.sent,
      note: sent.sent
        ? 'Email delivered.'
        : 'Email persisted in outbound queue. SES domain verification is not yet live — the email will dispatch automatically once CLIO_MAIL_SEND_ENABLED=true is set on the API task.',
    };
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requiredEmail(value: unknown, label: string): string {
  const v = requiredString(value, label);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
    throw new BadRequestException(`${label} must be a valid email address`);
  }
  return v.toLowerCase();
}

function optionalEmail(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
    throw new BadRequestException('cc must be a valid email address');
  }
  return v;
}

function optionalUuid(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const v = value.trim();
  if (!/^[0-9a-f-]{36}$/i.test(v)) {
    throw new BadRequestException('inReplyToInboundId must be a UUID');
  }
  return v;
}
