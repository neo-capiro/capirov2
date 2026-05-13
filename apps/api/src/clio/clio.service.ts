import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ClioMessageRole, ClioSessionStatus, Prisma } from '@prisma/client';
import type { TenantContext } from '@capiro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClioRuntimeClient, type ClioChatMessage } from './clio-runtime.client.js';
import { UserMemoryService } from './memory/user-memory.service.js';
import { ToolRegistryService, type ClioTier } from './tools/tool-registry.service.js';

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
    // Structured metadata stamped on the message (tool-call summary,
    // attachments later). Schema-wise this is Prisma.JsonValue, but
    // any payload the API stamps in clio.service.ts goes through here.
    contentJson: unknown;
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
 * Default system prompt for internal-tier (@capiro.ai) sessions when the
 * caller didn't supply one. Hermes-style: framed as a general-purpose
 * assistant first, with Capiro-specific tools positioned as optional
 * capabilities — NOT as a Capiro-only chatbot. Without this, the tool
 * descriptions alone (get_client_context, render_artifact) bias the
 * model into greeting the user as "your Capiro AI assistant" even on
 * unrelated questions.
 */
const DEFAULT_INTERNAL_SYSTEM_PROMPT = `You are Clio, a personal AI assistant for a Capiro employee. Behave like a thoughtful chief-of-staff: helpful, direct, with continuity across conversations. Help the user with whatever they ask — coding, writing, research, analysis, math, casual conversation, anything. You are NOT restricted to lobbying or Capiro-specific topics.

Available tools (use only when the user's request clearly calls for them — do not advertise them up front):
- get_client_context, render_artifact: Capiro client lookups and policy memo / meeting brief rendering.
- web_search: search the public web. Use this for anything time-sensitive, current events, or facts that may have changed after your training cutoff. Don't search for things you reliably know.
- code_interpreter: run a short Python program in a sandbox. Use this whenever the task needs computation, transformation, API calls to public endpoints, or generation of files the user can download — Excel via openpyxl, Word via python-docx, PowerPoint via python-pptx, PDF via reportlab, images via Pillow, CSV/JSON outputs. Write files into /tmp/output/ inside the program and they'll come back as downloadable artifacts. If the user asks for "an Excel of X" or "draft a deck with Y" — that's code_interpreter, not render_artifact.
- send_email: send an email from the user's Clio mailbox (<slug>@clio.capiro.ai). Use this when the user asks you to "email X", "follow up with Y", or reply to an inbound thread. Confirm the recipient and subject before sending unless the user has explicitly authorized you to send immediately.
- remember_about_user: save a single durable fact about the user (preferences, ongoing projects, working style). Call this proactively when the user reveals something worth keeping across sessions. Don't dump every detail — be selective.
- forget_about_user: drop a previously-remembered fact by id when the user asks you to, or when something becomes false.

When memories about this user are available, they appear in the system prompt below. Use them naturally — don't recite them back, just let them shape your replies. If the user says "remember that I..." or "I always do X", call remember_about_user. If they say "forget X" or correct something, call forget_about_user.

Be direct and substantive. Skip throat-clearing preambles. If you don't know something, say so. If a tool returns an error, tell the user plainly.

When you need to ask the user a clarifying question — and ONLY then, not for general acknowledgements — emit it as a fenced code block tagged \`capiro-question\` containing JSON of this shape:

\`\`\`capiro-question
{
  "question": "Which clients should the memo cover?",
  "options": ["Acme Corp", "Globex", "Both"],
  "allowFreeText": true,
  "multi": false
}
\`\`\`

Rules:
- Use \`options\` only when the answer is a small enumerable set. Omit it for free-form questions.
- Set \`allowFreeText\` to true when the user might want to type something other than the listed options.
- Set \`multi\` to true when several options can be selected.
- Put no other text after the question block in that turn. The UI renders the block as a modal; surrounding prose is wasted.
- Ask at most one question per turn.`;

/**
 * Default system prompt for customer-tier sessions. Same shape, narrower
 * framing — customer-tier users get Clio as part of the Capiro product so
 * lobbying-adjacent help is the expected primary use case, but we still
 * don't refuse off-topic questions.
 */
const DEFAULT_CUSTOMER_SYSTEM_PROMPT = `You are Clio, a personal AI assistant inside the Capiro lobbying workspace. Help the user with whatever they ask. Most questions will be lobbying-, policy-, or client-management-related, but you should still engage with general questions (writing, research, summarization, etc.) when asked.

Available tools (use only when the request clearly calls for them):
- get_client_context, render_artifact: client lookups and artifact rendering.
- web_search: search the public web for current events or post-cutoff information.
- code_interpreter: run Python in a sandbox to compute, transform data, fetch from public APIs, or generate downloadable files (Excel, Word, PowerPoint, PDF, images, CSV, JSON). Use whenever the task needs work that goes beyond text.
- send_email: send mail from the user's Clio mailbox. Confirm recipient/subject before sending.
- remember_about_user / forget_about_user: durable per-user memory across sessions. Save genuinely useful facts (preferences, projects, working style), forget when asked.

When memories about this user appear below, weave them into your replies naturally — don't recite. Be direct and substantive; skip throat-clearing preambles.

When you need to ask the user a clarifying question — and ONLY then — emit it as a fenced code block tagged \`capiro-question\` containing JSON of this shape:

\`\`\`capiro-question
{
  "question": "Which client is the meeting brief for?",
  "options": ["Acme Corp", "Globex"],
  "allowFreeText": true,
  "multi": false
}
\`\`\`

Use \`options\` for enumerable choices, omit for free-form. Set \`allowFreeText\` to let the user type their own. Set \`multi\` to true for multi-select. Put no other text after the block; the UI renders it as a modal. Ask at most one question per turn.`;

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
  private readonly logger = new Logger(ClioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: ClioRuntimeClient,
    private readonly toolRegistry: ToolRegistryService,
    private readonly memory: UserMemoryService,
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
          contentJson: true,
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

    // Filter the tool registry by the caller's *current* tier, not the
    // tier stamped on the session at create time. Two reasons:
    //   1. Existing sessions created before tierFor() honored the user
    //      role would otherwise be stuck on 'customer' even for
    //      capiro_admin callers.
    //   2. During impersonation, ctx.role already swaps to the
    //      impersonated role, so the customer-tier tool subset (and the
    //      narrower system prompt) kick in automatically.
    const tier: ClioTier = this.tierFor(ctx);
    const tools = this.toolRegistry.toolsForTier(tier);

    // Load this user's persistent memories and splice them into the
    // system prompt. The model never sees a separate "recall" tool —
    // we just hand it the relevant facts every turn and let it use
    // them naturally. Memories surface ids so the model can later
    // call forget_about_user when asked to drop one.
    const memories = await this.memory.loadForPrompt(ctx.tenantId, ctx.userId);
    const memoryBlock = UserMemoryService.renderForPrompt(memories);
    const baseSystem =
      settings.systemPrompt ??
      (tier === 'internal' ? DEFAULT_INTERNAL_SYSTEM_PROMPT : DEFAULT_CUSTOMER_SYSTEM_PROMPT);
    const fullSystem = memoryBlock ? `${baseSystem}\n\n${memoryBlock}` : baseSystem;

    const reply = await this.runtime.chat({
      messages: turnMessages,
      model: session.model,
      system: fullSystem,
      sessionId,
      tools: tools.length > 0 ? tools : undefined,
    });

    // First-turn auto-titling. If the session still has the default
    // "New session" placeholder, ask the model to summarize the user's
    // first message into a 3-7 word title and persist it. Fire-and-
    // forget so the response to the user isn't blocked on it.
    const isFirstTurn = history.length === 0;
    if (isFirstTurn && session.title === DEFAULT_TITLE) {
      void this.autoTitleSession(ctx.tenantId, sessionId, userContent, session.model).catch(
        (err) => this.logger.warn(`auto-title failed: ${String(err)}`),
      );
    }

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
          // The agent loop may have hit one or more tools to get here.
          // Stash the summary in content_jsonb so the UI can render
          // "🔧 Called get_client_context (45ms)" rows beneath the
          // assistant bubble. Schema doesn't need a new column — this
          // is exactly the kind of structured per-message metadata
          // content_jsonb was added for.
          ...(reply.toolCalls && reply.toolCalls.length > 0
            ? { contentJson: { toolCalls: reply.toolCalls } satisfies Prisma.InputJsonValue }
            : {}),
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
          contentJson: true,
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
   * to and which default system prompt frames the conversation.
   *
   * Internal: capiro_admin (Capiro staff impersonating into customer
   * tenants OR working in the capiro-internal tenant). Gets the full
   * tool surface and a general-purpose Hermes-style framing.
   * Customer: every other tenant role. Gets the customer-tier tool
   * subset and a slightly narrower framing.
   *
   * Tenant context doesn't carry the user's email today, so we use the
   * role on the membership as the signal (set by the Clerk webhook when
   * the user is a member of the reserved `capiro-internal` org). Email
   * domain would be redundant — capiro_admin is already gated to
   * verified @capiro.ai users by the webhook.
   */
  private tierFor(ctx: TenantContext): 'internal' | 'customer' {
    return ctx.role === 'capiro_admin' ? 'internal' : 'customer';
  }

  /**
   * Generate a short title for a session from its first user message.
   * Runs as a separate Bedrock pass (cheap — no tools, 24-token cap)
   * and writes the result back to the row. Fire-and-forget caller; we
   * don't fail the chat turn on title errors.
   */
  private async autoTitleSession(
    tenantId: string,
    sessionId: string,
    firstMessage: string,
    model: string,
  ): Promise<void> {
    const titlePrompt =
      'You are a title generator. Read the user message and reply with ONLY a 3-7 word title that summarizes the topic. No punctuation at the end. No quotes around it. No prefatory text like "Title:". Pure title.';
    const reply = await this.runtime.chat({
      messages: [{ role: 'user', content: firstMessage }],
      model,
      system: titlePrompt,
      sessionId,
      maxTokens: 24,
      temperature: 0.2,
    });
    const raw = reply.message.content.trim().replace(/^["']|["']$/g, '');
    // Hard cap so a chatty model can't blow out the sidebar layout.
    const title = raw.length > 80 ? raw.slice(0, 80).trim() : raw;
    if (!title) return;
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.clioSession.update({
        where: { id: sessionId },
        data: { title },
      }),
    );
  }
}
