import { Injectable } from '@nestjs/common';
import { ClioMailService } from '../mail/clio-mail.service.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

/**
 * Tells the agent what the user's Clio email address is. Useful when
 * the user asks "what's my Clio email" or when the agent wants to
 * tell the user it can be reached at a specific address.
 *
 * Auto-provisions the mailbox if it doesn't exist yet — same
 * idempotent ensureMailbox call as the SPA endpoint. Side effect:
 * the model can effectively bootstrap a user's mailbox just by
 * calling this tool once.
 */
@Injectable()
export class GetMyClioEmailTool implements Tool {
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'get_my_clio_email',
    description:
      "Get the user's dedicated Clio email address — they can email Clio at this address from anywhere, CC Clio on threads, etc. " +
      "Use when the user asks 'what's my Clio email' / 'how can I email Clio' / 'what address should I CC' / etc.",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  };

  constructor(private readonly mail: ClioMailService) {}

  async execute(_rawInput: Record<string, unknown>, ctx: ToolExecutionContext) {
    const mb = await this.mail.ensureMailbox(ctx.tenantId, ctx.userId, {});
    return {
      ok: true,
      address: mb.fullAddress,
      autoReply: mb.autoReply,
    };
  }
}
