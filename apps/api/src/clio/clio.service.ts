import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ClioMessageRole, ClioSessionStatus, Prisma } from '@prisma/client';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClioRuntimeClient, type ClioChatMessage } from './clio-runtime.client.js';

export interface CreateSessionInput {
  title?: string;
  model?: string;
  systemPrompt?: string;
}

export interface SendMessageInput {
  content: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  model: string;
  status: ClioSessionStatus;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionWithMessages extends SessionSummary {
  messages: Array<{
    id: string;
    role: ClioMessageRole;
    content: string | null;
    createdAt: Date;
    inputTokens: number | null;
    outputTokens: number | null;
    stopReason: string | null;
  }>;
}

const DEFAULT_TITLE = 'New session';
// Default Bedrock cross-region inference profile. Mirrors the Clio
// runtime default; persisted on the session so a future runtime default
// change doesn't silently switch model mid-conversation.
const DEFAULT_MODEL = 'us.anthropic.claude-sonnet-4-6';

/**
 * Owns the read/write side of `clio_sessions` and `clio_messages` and
 * orchestrates the round-trip to the Clio runtime for chat turns.
 *
 * RLS is enforced at the database layer — every read/write goes through
 * `prisma.withTenant(...)` which sets the `app.current_tenant` GUC inside
 * a transaction. Even if the service code accidentally omitted a
 * `tenantId` filter, Postgres would still return zero rows.
 *
 * Sessions are also user-scoped within a tenant. We enforce that in the
 * service layer (NotFound when the user doesn't own the session) rather
 * than via RLS, so capiro_admin can still impersonate-read sessions
 * across users in the same tenant when needed.
 */
@Injectable()
export class ClioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: ClioRuntimeClient,
  ) {}

  async listSessions(ctx: TenantContext): Promise<SessionSummary[]> {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.clioSession.findMany({
        where: { userId: ctx.userId, status: { not: 'deleted' } },
        orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        take: 100,
        select: {
          id: true,
          title: true,
          model: true,
          status: true,
          lastMessageAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return rows;
    });
  }

  async createSession(ctx: TenantContext, input: CreateSessionInput): Promise<SessionSummary> {
    const settings: Prisma.InputJsonValue = {
      tier: this.tierFor(ctx),
      ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    };
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const row = await tx.clioSession.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          title: input.title?.trim() || DEFAULT_TITLE,
          model: input.model ?? DEFAULT_MODEL,
          settings,
        },
        select: {
          id: true,
          title: true,
          model: true,
          status: true,
          lastMessageAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return row;
    });
  }

  async getSession(ctx: TenantContext, sessionId: string): Promise<SessionWithMessages> {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const session = await tx.clioSession.findFirst({
        where: { id: sessionId, userId: ctx.userId, status: { not: 'deleted' } },
        select: {
          id: true,
          title: true,
          model: true,
          status: true,
          lastMessageAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!session) throw new NotFoundException('Session not found');

      const messages = await tx.clioMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
          inputTokens: true,
          outputTokens: true,
          stopReason: true,
        },
      });

      return { ...session, messages };
    });
  }

  async sendMessage(
    ctx: TenantContext,
    sessionId: string,
    input: SendMessageInput,
  ): Promise<SessionWithMessages> {
    const userContent = input.content.trim();
    if (!userContent) throw new ForbiddenException('Message content required');

    // Pull session + history first inside one tx so we have a coherent view
    // before we leave the DB to call the model. The model call itself runs
    // outside the tx — we don't want to hold a Postgres transaction open
    // for tens of seconds while Bedrock thinks.
    const { session, history, settings } = await this.prisma.withTenant(
      ctx.tenantId,
      async (tx) => {
        const session = await tx.clioSession.findFirst({
          where: { id: sessionId, userId: ctx.userId, status: 'active' },
        });
        if (!session) throw new NotFoundException('Session not found or not active');

        const history = await tx.clioMessage.findMany({
          where: { sessionId },
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true, contentJson: true },
        });
        return {
          session,
          history,
          settings: (session.settings ?? {}) as { systemPrompt?: string; tier?: string },
        };
      },
    );

    const turnMessages: ClioChatMessage[] = [
      ...history
        .filter((h): h is { role: 'user' | 'assistant' | 'system' | 'tool'; content: string | null; contentJson: Prisma.JsonValue } =>
          (h.role === 'user' || h.role === 'assistant' || h.role === 'system') && h.content != null,
        )
        .map((h) => ({ role: h.role as 'user' | 'assistant' | 'system', content: h.content as string })),
      { role: 'user', content: userContent },
    ];

    const reply = await this.runtime.chat({
      messages: turnMessages,
      model: session.model,
      system: settings.systemPrompt,
    });

    // Persist user turn + assistant turn + bump session.last_message_at in
    // one transaction so we don't end up with an orphaned user message if
    // the assistant insert fails.
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      await tx.clioMessage.create({
        data: {
          sessionId,
          tenantId: ctx.tenantId,
          role: 'user',
          content: userContent,
        },
      });
      await tx.clioMessage.create({
        data: {
          sessionId,
          tenantId: ctx.tenantId,
          role: 'assistant',
          content: reply.message.content,
          inputTokens: reply.usage.inputTokens,
          outputTokens: reply.usage.outputTokens,
          stopReason: reply.stopReason,
        },
      });
      await tx.clioSession.update({
        where: { id: sessionId },
        data: { lastMessageAt: new Date() },
      });

      const updated = await tx.clioSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: {
          id: true,
          title: true,
          model: true,
          status: true,
          lastMessageAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      const messages = await tx.clioMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
          inputTokens: true,
          outputTokens: true,
          stopReason: true,
        },
      });
      return { ...updated, messages };
    });
  }

  async archiveSession(ctx: TenantContext, sessionId: string): Promise<void> {
    await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const result = await tx.clioSession.updateMany({
        where: { id: sessionId, userId: ctx.userId, status: 'active' },
        data: { status: 'archived' },
      });
      if (result.count === 0) throw new NotFoundException('Session not found or already inactive');
    });
  }

  /**
   * Internal vs customer tier — drives which tools the agent has access
   * to in later phases. For Phase 1 there are no tools, so this only
   * affects the metadata stamped on the session for future inspection.
   *
   * Internal: any user whose Clerk-resolved email ends in @capiro.ai.
   * Customer: everyone else.
   *
   * Tenant context doesn't carry the email today, so the cleaner version
   * of this check belongs in a follow-up that adds `email` to TenantContext.
   * For now we conservatively return 'customer' and rely on the tier flag
   * being a hint, not the security boundary.
   */
  private tierFor(_ctx: TenantContext): 'internal' | 'customer' {
    return 'customer';
  }
}
