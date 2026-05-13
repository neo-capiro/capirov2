import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Patch,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';
import { TenantContextStore } from '../../tenant/tenant-context.store.js';
import { ClioMailService } from './clio-mail.service.js';

/**
 * User-facing endpoints for a Capiro user's own Clio mailbox.
 *
 *   GET    /api/clio/mailbox         — read (auto-provisions if missing)
 *   PATCH  /api/clio/mailbox         — update slug or autoReply
 *   GET    /api/clio/mailbox/inbox   — recent inbound mail
 *
 * The user sees their Clio address in the Workspace and can click
 * "copy". Renaming is intentionally allowed once (we don't enforce the
 * once-only constraint server-side yet — the SPA hides the rename
 * affordance after a successful one).
 *
 * Auth model: this controller doesn't apply a guard. The tenant-context
 * middleware runs ahead of it for /api/* routes, populates
 * TenantContextStore from the Clerk JWT, and a missing context throws
 * a 401 in `store.require()` below.
 */
class UpdateMailboxDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/, {
    message: 'localPart must be 2-40 chars, lowercase letters / digits / hyphens',
  })
  @Length(2, 40)
  localPart?: string;

  @IsOptional()
  @IsBoolean()
  autoReply?: boolean;
}

@Controller('clio/mailbox')
export class ClioMailboxController {
  private readonly logger = new Logger(ClioMailboxController.name);

  constructor(
    private readonly mail: ClioMailService,
    private readonly store: TenantContextStore,
  ) {}

  @Get()
  async getMine() {
    const ctx = this.store.require();
    // ensureMailbox is idempotent — if the user already has one we get
    // it back, otherwise we provision and return. Side effect: hitting
    // /api/clio/mailbox in the SPA is enough to bootstrap a user who
    // hasn't been auto-provisioned yet.
    const mb = await this.mail.ensureMailbox(ctx.tenantId, ctx.userId, {});
    return shape(mb);
  }

  @Patch()
  async update(@Body() body: UpdateMailboxDto) {
    if (body.localPart === undefined && body.autoReply === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    const ctx = this.store.require();
    let row = await this.mail.ensureMailbox(ctx.tenantId, ctx.userId, {});
    if (body.localPart && body.localPart !== row.localPart) {
      row = await this.mail.renameMailbox(ctx.tenantId, ctx.userId, body.localPart);
    }
    if (body.autoReply !== undefined && body.autoReply !== row.autoReply) {
      row = await this.mail.setAutoReply(ctx.tenantId, ctx.userId, body.autoReply);
    }
    return shape(row);
  }

  @Get('inbox')
  async inbox() {
    const ctx = this.store.require();
    const items = await this.mail.listInbox(ctx.tenantId, ctx.userId);
    return { items };
  }
}

function shape(mb: {
  id: string;
  localPart: string;
  fullAddress: string;
  active: boolean;
  autoReply: boolean;
  createdAt: Date;
}) {
  return {
    id: mb.id,
    localPart: mb.localPart,
    fullAddress: mb.fullAddress,
    active: mb.active,
    autoReply: mb.autoReply,
    createdAt: mb.createdAt.toISOString(),
  };
}
