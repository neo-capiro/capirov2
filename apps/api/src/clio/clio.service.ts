import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { TenantContext } from '@capiro/shared';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClioToolsService } from './clio-tools.service.js';

interface CreateConversationInput {
  clientId?: string;
  title?: string;
}

interface UpdateConversationInput {
  title?: string;
  clientId?: string | null;
}

type ConfidenceLevel = 'high' | 'medium' | 'low';

type RetrievalTier = 'fast' | 'deep';

interface OrchestratorPolicy {
  tier: RetrievalTier;
  contextCharBudget: number;
  researchLimit: number;
  researchChars: number;
  intelChars: number;
  clientContextChars: number;
}

interface OrchestratorTraceStep {
  tool: string;
  action: 'selected' | 'skipped';
  reason: string;
}

interface ClioSourceAttribution {
  tool: string;
  count?: number;
  summary: string;
  confidence: ConfidenceLevel;
}

interface OrchestratorConflict {
  title: string;
  detail: string;
}

interface OrchestratorResult {
  context: string;
  sources: ClioSourceAttribution[];
  policy: OrchestratorPolicy;
  trace: OrchestratorTraceStep[];
  conflict: OrchestratorConflict | null;
  template: {
    heading: string;
    sections: string[];
  } | null;
}

interface StreamControl {
  traceEnabled: boolean;
  cleanContent: string;
  pageWriteEnabled: boolean;
}

interface RuntimeMessage {
  id?: unknown;
  role?: unknown;
  text?: unknown;
  body?: unknown;
  content?: unknown;
  markdown?: unknown;
  artifacts?: unknown;
  metadata?: unknown;
}

interface RuntimeArtifact {
  title?: unknown;
  kind?: unknown;
  contentType?: unknown;
  bodyText?: unknown;
  body?: unknown;
  content?: unknown;
  s3Key?: unknown;
  metadata?: unknown;
}

interface RuntimeChatCompletionResponse {
  id?: unknown;
  choices?: unknown;
  usage?: unknown;
  hermes?: unknown;
}

interface RuntimeChatChoice {
  message?: unknown;
  finish_reason?: unknown;
}

interface RuntimeChatMessage {
  content?: unknown;
}

const RUNTIME_NAME = 'Hermes';
const PRODUCT_NAME = 'Clio';

@Injectable()
export class ClioService {
  private readonly logger = new Logger(ClioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly tools: ClioToolsService,
  ) {}

  async status(ctx: TenantContext) {
    const runtimeBaseUrl = this.runtimeBaseUrl();
    const profile = await this.currentProfile(ctx);
    const configured = Boolean(runtimeBaseUrl);
    if (!runtimeBaseUrl) {
      return {
        brand: PRODUCT_NAME,
        runtime: RUNTIME_NAME,
        configured,
        healthy: false,
        user: profile,
        tools: this.tools.manifest(),
        detail: 'Clio runtime is not configured.',
      };
    }

    try {
      const health = await this.runtimeRequest<Record<string, unknown>>('/health', {
        method: 'GET',
        timeoutMs: 5_000,
      });
      return {
        brand: PRODUCT_NAME,
        runtime: RUNTIME_NAME,
        configured,
        healthy: true,
        user: profile,
        tools: this.tools.manifest(),
        detail: typeof health.status === 'string' ? health.status : 'Runtime reachable.',
      };
    } catch (err) {
      return {
        brand: PRODUCT_NAME,
        runtime: RUNTIME_NAME,
        configured,
        healthy: false,
        user: profile,
        tools: this.tools.manifest(),
        detail: errorMessage(err),
      };
    }
  }

  async listConversations(ctx: TenantContext) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const conversations = await tx.clioConversation.findMany({
        where: { tenantId: ctx.tenantId, userId: ctx.userId, archivedAt: null },
        orderBy: { updatedAt: 'desc' },
        include: {
          client: { select: { id: true, name: true, logoS3Key: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          artifacts: { orderBy: { createdAt: 'desc' }, take: 4 },
        },
      });
      return conversations.map((conversation) => ({
        ...conversation,
        latestMessage: conversation.messages[0] ?? null,
        messages: undefined,
      }));
    });
  }

  async createConversation(ctx: TenantContext, input: CreateConversationInput) {
    const title = input.title?.trim() || 'New Clio session';
    if (input.clientId) {
      await this.ensureClientVisible(ctx, input.clientId);
    }
    const profile = await this.currentProfile(ctx);
    const platformId = this.clioPlatformId(ctx);

    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioConversation.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          clientId: input.clientId ?? null,
          title,
          workspaceKey: 'workspace',
          nanoclawPlatformId: platformId,
          metadata: {
            brand: PRODUCT_NAME,
            runtime: RUNTIME_NAME,
            userEmail: profile.email,
          },
        },
      }),
    );
  }

  async getConversation(ctx: TenantContext, conversationId: string) {
    return this.ensureConversation(ctx, conversationId);
  }

  async updateConversation(ctx: TenantContext, conversationId: string, input: UpdateConversationInput) {
    const conversation = await this.ensureConversation(ctx, conversationId);
    const data: Prisma.ClioConversationUpdateInput = {};

    if (typeof input.title === 'string') {
      const title = input.title.trim();
      if (!title) throw new BadRequestException('Conversation title cannot be empty');
      data.title = title;
    }

    if (input.clientId !== undefined) {
      if (input.clientId) await this.ensureClientVisible(ctx, input.clientId);
      data.client = input.clientId
        ? { connect: { id: input.clientId } }
        : { disconnect: true };
    }

    if (!Object.keys(data).length) {
      return conversation;
    }

    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const updated = await tx.clioConversation.update({
        where: { id: conversationId },
        data: { ...data, updatedAt: new Date() },
        include: { client: { select: { id: true, name: true } } },
      });

      if (input.clientId !== undefined) {
        await Promise.all([
          tx.clioMessage.updateMany({
            where: {
              tenantId: ctx.tenantId,
              userId: ctx.userId,
              conversationId,
            },
            data: { clientId: input.clientId ?? null },
          }),
          tx.clioArtifact.updateMany({
            where: {
              tenantId: ctx.tenantId,
              userId: ctx.userId,
              conversationId,
            },
            data: { clientId: input.clientId ?? null },
          }),
        ]);
      }

      return updated;
    });
  }

  async archiveConversation(ctx: TenantContext, conversationId: string) {
    await this.ensureConversation(ctx, conversationId);
    await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioConversation.update({
        where: { id: conversationId },
        data: { archivedAt: new Date(), status: 'archived' },
      }),
    );
    return { ok: true, id: conversationId };
  }

  async restoreConversation(ctx: TenantContext, conversationId: string) {
    const conversation = await this.ensureConversationAnyStatus(ctx, conversationId);
    if (!conversation.archivedAt) return conversation;
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioConversation.update({
        where: { id: conversationId },
        data: { archivedAt: null, status: 'active', updatedAt: new Date() },
        include: { client: { select: { id: true, name: true } } },
      }),
    );
  }

  async listMessages(ctx: TenantContext, conversationId: string) {
    await this.ensureConversation(ctx, conversationId);
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioMessage.findMany({
        where: { tenantId: ctx.tenantId, userId: ctx.userId, conversationId },
        orderBy: { createdAt: 'asc' },
        include: { artifacts: { orderBy: { createdAt: 'asc' } } },
      }),
    );
  }

  async sendMessage(ctx: TenantContext, conversationId: string, rawBody: string) {
    const body = rawBody.trim();
    if (!body) throw new BadRequestException('Message body is required');
    if (!this.runtimeBaseUrl()) {
      throw new ServiceUnavailableException('Clio runtime is not configured');
    }

    const conversation = await this.ensureConversation(ctx, conversationId);
    const profile = await this.currentProfile(ctx);
    const clientContext = conversation.clientId
      ? await this.clientContextForRuntime(ctx, conversation.clientId)
      : null;

    const userMessage = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const created = await tx.clioMessage.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          clientId: conversation.clientId,
          conversationId,
          role: 'user',
          body,
          metadata: { source: 'capiro-workspace' },
        },
      });
      await tx.clioConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date(), title: conversation.title || titleFromMessage(body) },
      });
      return created;
    });

    const runtimeResponse = await this.runtimeRequest<RuntimeChatCompletionResponse>('/v1/chat/completions', {
      method: 'POST',
      headers: this.scopedRuntimeHeaders(ctx, conversation),
      body: {
        model: PRODUCT_NAME.toLowerCase(),
        stream: false,
        messages: [
          { role: 'system', content: this.systemPrompt(ctx, conversation, profile, clientContext) },
          { role: 'user', content: body },
        ],
      },
    });

    const normalizedMessages = normalizeRuntimeMessagesFromChatCompletion(runtimeResponse);
    const normalizedArtifacts: ReturnType<typeof normalizeRuntimeArtifacts> = [];
    if (!normalizedMessages.length && !normalizedArtifacts.length) {
      throw new BadGatewayException('Clio runtime returned no messages or artifacts');
    }

    const persisted = await this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const assistantMessages = [];
      for (const runtimeMessage of normalizedMessages) {
        const message = await tx.clioMessage.create({
          data: {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            clientId: conversation.clientId,
            conversationId,
            role: runtimeMessage.role,
            body: runtimeMessage.body,
            nanoclawId: runtimeMessage.nanoclawId,
            metadata: runtimeMessage.metadata,
          },
        });
        assistantMessages.push(message);

        for (const artifact of runtimeMessage.artifacts) {
          await tx.clioArtifact.create({
            data: {
              tenantId: ctx.tenantId,
              userId: ctx.userId,
              clientId: conversation.clientId,
              conversationId,
              messageId: message.id,
              ...artifact,
            },
          });
        }
      }

      for (const artifact of normalizedArtifacts) {
        await tx.clioArtifact.create({
          data: {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            clientId: conversation.clientId,
            conversationId,
            ...artifact,
          },
        });
      }

      await tx.clioConversation.update({
        where: { id: conversationId },
        data: {
          updatedAt: new Date(),
          title: conversation.title === 'New Clio session' ? titleFromMessage(body) : conversation.title,
        },
      });

      return {
        userMessage,
        assistantMessages,
        artifacts: await tx.clioArtifact.findMany({
          where: { tenantId: ctx.tenantId, userId: ctx.userId, conversationId },
          orderBy: { createdAt: 'desc' },
        }),
      };
    });

    return persisted;
  }

  private async ensureConversation(ctx: TenantContext, conversationId: string) {
    const conversation = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioConversation.findFirst({
        where: {
          id: conversationId,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          archivedAt: null,
        },
        include: { client: { select: { id: true, name: true } } },
      }),
    );
    if (!conversation) throw new NotFoundException('Clio conversation not found');
    return conversation;
  }

  private async ensureConversationAnyStatus(ctx: TenantContext, conversationId: string) {
    const conversation = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioConversation.findFirst({
        where: {
          id: conversationId,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
        },
        include: { client: { select: { id: true, name: true } } },
      }),
    );
    if (!conversation) throw new NotFoundException('Clio conversation not found');
    return conversation;
  }

  private async ensureClientVisible(ctx: TenantContext, clientId: string) {
    const client = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.client.findFirst({
        where: { id: clientId, tenantId: ctx.tenantId, status: { not: 'archived' } },
        select: { id: true },
      }),
    );
    if (!client) throw new NotFoundException('Client not found');
  }

  private async currentProfile(ctx: TenantContext) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: ctx.userId },
        select: { email: true, firstName: true, lastName: true },
      });
      const displayName =
        [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || 'Capiro user';
      return {
        id: ctx.userId,
        clerkUserId: ctx.clerkUserId,
        email: user?.email ?? null,
        displayName,
      };
    });
  }

  private async clientContextForRuntime(ctx: TenantContext, clientId: string) {
    return this.prisma.withTenant(ctx.tenantId, async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: clientId, tenantId: ctx.tenantId, status: { not: 'archived' } },
        select: {
          id: true,
          name: true,
          website: true,
          description: true,
          productDescription: true,
          primaryContactName: true,
          primaryContactEmail: true,
          intakeData: true,
        },
      });
      if (!client) throw new NotFoundException('Client not found');

      const [meetings, mailThreads, tasks] = await Promise.all([
        tx.meeting.findMany({
          where: {
            tenantId: ctx.tenantId,
            clientId,
            OR: [{ createdByUserId: ctx.userId }, { connection: { createdByUserId: ctx.userId } }],
          },
          orderBy: { startsAt: 'desc' },
          take: 8,
          select: {
            id: true,
            subject: true,
            startsAt: true,
            endsAt: true,
            organizerEmail: true,
            organizerName: true,
            status: true,
          },
        }),
        tx.mailThread.findMany({
          where: {
            tenantId: ctx.tenantId,
            clientId,
            connection: { createdByUserId: ctx.userId },
          },
          orderBy: { lastMessageAt: 'desc' },
          take: 8,
          select: {
            id: true,
            subject: true,
            snippet: true,
            lastMessageAt: true,
            status: true,
          },
        }),
        tx.engagementTask.findMany({
          where: { tenantId: ctx.tenantId, clientId, status: { not: 'canceled' } },
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
          take: 8,
          select: {
            id: true,
            title: true,
            description: true,
            dueDate: true,
            status: true,
          },
        }),
      ]);

      return { client, meetings, mailThreads, tasks };
    });
  }

  private runtimeBaseUrl(): string | undefined {
    return (
      this.config.get('CLIO_RUNTIME_BASE_URL', { infer: true }) ??
      this.config.get('CLIO_NANOCLAW_BASE_URL', { infer: true })
    );
  }

  private async runtimeRequest<T>(
    pathname: string,
    options: {
      method: 'GET' | 'POST';
      body?: unknown;
      timeoutMs?: number;
      headers?: Record<string, string>;
    },
  ): Promise<T> {
    const baseUrl = this.runtimeBaseUrl();
    if (!baseUrl) throw new ServiceUnavailableException('Clio runtime is not configured');

    const url = new URL(pathname.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    const timeoutMs =
      options.timeoutMs ??
      this.config.get('CLIO_RUNTIME_TIMEOUT_MS', { infer: true }) ??
      this.config.get('CLIO_NANOCLAW_TIMEOUT_MS', { infer: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    const apiKey =
      this.config.get('CLIO_RUNTIME_API_KEY', { infer: true }) ??
      this.config.get('CLIO_NANOCLAW_API_KEY', { infer: true });
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    try {
      const response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Runtime ${response.status}: ${text.slice(0, 500) || response.statusText}`);
      }
      return text ? (JSON.parse(text) as T) : ({} as T);
    } catch (err) {
      this.logger.warn(`Clio runtime request failed: ${errorMessage(err)}`);
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException(`Clio runtime unavailable: ${errorMessage(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private scopedRuntimeHeaders(
    ctx: TenantContext,
    conversation: { id: string; workspaceKey: string; clientId: string | null },
  ): Record<string, string> {
    return {
      'X-Hermes-Session-Id': conversation.id,
      'X-Hermes-Session-Key': [
        `tenant:${ctx.tenantId}`,
        `user:${ctx.userId}`,
        `workspace:${conversation.workspaceKey}`,
        conversation.clientId ? `client:${conversation.clientId}` : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join('|'),
      'X-Capiro-Tenant-Id': ctx.tenantId,
      'X-Capiro-User-Id': ctx.userId,
    };
  }

  private systemPrompt(
    ctx: TenantContext,
    conversation: { id: string; title: string; clientId: string | null; workspaceKey: string },
    profile: { email: string | null; displayName: string },
    clientContext: unknown,
  ): string {
    return [
      "You are Clio, Capiro's workspace assistant for lobbying teams.",
      'Use the signed-in Capiro identity and tenant context supplied below. Do not ask the browser for tenant IDs, user IDs, or permissions.',
      'Respect that Capiro is the authorization boundary. Only use facts present in this prompt, the conversation, and runtime tools that are already enabled in the private runtime.',
      'When you create a draft or artifact, write it as clean Markdown with a concise title.',
      '',
      JSON.stringify(
        {
          product: PRODUCT_NAME,
          tenant: { id: ctx.tenantId, slug: ctx.tenantSlug },
          user: {
            id: ctx.userId,
            clerkUserId: ctx.clerkUserId,
            email: profile.email,
            name: profile.displayName,
            role: ctx.role,
          },
          conversation: {
            id: conversation.id,
            title: conversation.title,
            clientId: conversation.clientId,
            workspaceKey: conversation.workspaceKey,
          },
          clientContext,
          capiroTools: {
            manifest: this.tools.manifest(),
            runtimeEndpoint: '/api/clio/runtime/tools/{toolName}',
            conversationId: conversation.id,
            auth: 'private_bearer_key',
          },
        },
        null,
        2,
      ),
    ].join('\n');
  }

  private clioPlatformId(ctx: TenantContext): string {
    return `capiro:${ctx.tenantId}:${ctx.userId}`;
  }

  // ── SSE Streaming (Phase 1: Unified brain) ──

  async streamMessage(ctx: TenantContext, conversationId: string, body: string, sse: { write: (data: string) => void }) {
    const conversation = await this.ensureConversation(ctx, conversationId);
    const streamControl = this.extractStreamControl(body);
    const content = streamControl.cleanContent.trim();
    if (!content) throw new BadRequestException('Message body is empty');

    // Persist user message
    await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioMessage.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          clientId: conversation.clientId ?? null,
          conversationId,
          role: 'user',
          body: content,
          metadata: {},
        },
      }),
    );

    // Load recent history
    const history = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioMessage.findMany({
        where: { conversationId, role: { in: ['user', 'assistant'] } },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: { role: true, body: true },
      }),
    );

    // Classify intent
    const intent = await this.classifyIntent(content);
    this.logger.debug(`Stream intent: ${intent}`);

    const orchestration = await this.orchestrateContext(ctx, conversation.clientId, intent, content);
    const unifiedSystemPrompt = this.buildUnifiedSystemPrompt(intent, orchestration.context, orchestration.template);

    sse.write(`data: ${JSON.stringify({ type: 'start', intent, tier: orchestration.policy.tier })}\n\n`);
    if (streamControl.pageWriteEnabled) {
      sse.write(
        `data: ${JSON.stringify({
          type: 'page_write',
          target: 'outreach_draft',
          note: 'Write mode enabled: updates will be applied to this page when supported.',
        })}\n\n`,
      );
    }
    if (streamControl.traceEnabled) {
      sse.write(`data: ${JSON.stringify({ type: 'trace', trace: orchestration.trace, policy: orchestration.policy })}\n\n`);
    }
    if (orchestration.sources.length) {
      sse.write(`data: ${JSON.stringify({ type: 'sources', sources: orchestration.sources })}\n\n`);
    }
    if (orchestration.conflict) {
      sse.write(`data: ${JSON.stringify({ type: 'conflict', conflict: orchestration.conflict })}\n\n`);
    }
    if (orchestration.template) {
      sse.write(`data: ${JSON.stringify({ type: 'template', template: orchestration.template })}\n\n`);
    }

    let assistantContent = '';
    try {
      const anthropicKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
      if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured');

      const messages = history.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.body,
      }));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 4000,
            stream: true,
            system: unifiedSystemPrompt,
            messages,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Anthropic HTTP ${response.status}`);
        }

        const decoder = new TextDecoder();
        const responseBody = response.body as unknown as AsyncIterable<Uint8Array>;
        let buffer = '';

        for await (const chunk of responseBody) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.type === 'content_block_delta') {
                const delta = evt.delta ?? {};
                if (delta.type === 'text_delta' && typeof delta.text === 'string') {
                  assistantContent += delta.text;
                  sse.write(`data: ${JSON.stringify({ type: 'text', text: delta.text })}\n\n`);
                }
              }
            } catch { /* incomplete chunk */ }
          }
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI generation failed';
      sse.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
      assistantContent = `Error: ${msg}`;
    }

    // Persist assistant response
    await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioMessage.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          clientId: conversation.clientId ?? null,
          conversationId,
          role: 'assistant',
          body: assistantContent,
          metadata: {
            intent,
            tier: orchestration.policy.tier,
            sources: orchestration.sources.map((source) => source.tool),
            sourceConfidence: orchestration.sources.map((source) => ({ tool: source.tool, confidence: source.confidence })),
            hasConflict: Boolean(orchestration.conflict),
          },
        },
      }),
    );

    // Auto-summarize for memory (if substantial)
    if (assistantContent.length > 200) {
      void this.maybeLearnFromConversation(ctx.tenantId, ctx.userId, conversationId, content, assistantContent).catch(() => {});
    }

    // Generate proactive alerts in background
    void this.generateProactiveAlerts(ctx.tenantId).catch(() => {});

    sse.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  }

  private async orchestrateContext(
    ctx: TenantContext,
    clientId: string | null,
    intent: string,
    query: string,
  ): Promise<OrchestratorResult> {
    const policy = this.policyForIntent(intent, query);
    const contextParts: string[] = [];
    const sources: ClioSourceAttribution[] = [];
    const trace: OrchestratorTraceStep[] = [];

    if (clientId) {
      trace.push({ tool: 'client_profile', action: 'selected', reason: 'Client-linked conversation has priority context.' });
      try {
        const client = await this.prisma.withTenant(ctx.tenantId, (tx) =>
          tx.client.findFirst({
            where: { id: clientId },
            select: { name: true, description: true, productDescription: true },
          }),
        );
        if (client) {
          contextParts.push(`Client: ${client.name}`);
          if (client.description) contextParts.push(`Description: ${client.description}`);
          if (client.productDescription) contextParts.push(`Product/service: ${client.productDescription}`);
          sources.push({
            tool: 'client_profile',
            count: 1,
            summary: `Client profile loaded for ${client.name}`,
            confidence: 'high',
          });
        }
      } catch {
        trace.push({ tool: 'client_profile', action: 'skipped', reason: 'Client profile fetch failed.' });
      }
    } else {
      trace.push({ tool: 'client_profile', action: 'skipped', reason: 'Conversation is not attached to a client.' });
    }

    try {
      const memories = await this.loadRelevantMemories(ctx.tenantId, ctx.userId, query);
      if (memories.length) {
        contextParts.push('\nRelevant firm knowledge (from Clio memory):');
        for (const mem of memories) contextParts.push(`- ${mem.value}`);
        sources.push({
          tool: 'clio_memory',
          count: memories.length,
          summary: `Loaded ${memories.length} memory items`,
          confidence: memories.length >= 3 ? 'high' : 'medium',
        });
        trace.push({ tool: 'clio_memory', action: 'selected', reason: `Loaded ${memories.length} relevant memories.` });
      } else {
        trace.push({ tool: 'clio_memory', action: 'skipped', reason: 'No high-signal memories matched query.' });
      }
    } catch {
      trace.push({ tool: 'clio_memory', action: 'skipped', reason: 'Memory retrieval failed.' });
    }

    const shouldLoadResearch = ['query_clients', 'query_engagement', 'query_workflow', 'generate_draft', 'general_question', 'generate_briefing'].includes(intent);
    if (shouldLoadResearch) {
      trace.push({ tool: 'search_research_sources', action: 'selected', reason: `Intent ${intent} benefits from workspace research context.` });
      try {
        const research = await this.tools.execute(ctx, 'search_research_sources' as never, {
          query,
          clientId: clientId ?? undefined,
          limit: policy.researchLimit,
        });
        const results = Array.isArray((research as { results?: unknown[] }).results)
          ? ((research as { results?: unknown[] }).results ?? [])
          : [];
        if (results.length) {
          contextParts.push('\nCapiro research context:');
          contextParts.push(summarizeJsonForPrompt(results, policy.researchChars));
          sources.push({
            tool: 'search_research_sources',
            count: results.length,
            summary: `Loaded ${results.length} research records`,
            confidence: results.length >= 5 ? 'high' : 'medium',
          });
        } else {
          trace.push({ tool: 'search_research_sources', action: 'skipped', reason: 'No research results returned.' });
        }
      } catch {
        trace.push({ tool: 'search_research_sources', action: 'skipped', reason: 'Research tool request failed.' });
      }
    } else {
      trace.push({ tool: 'search_research_sources', action: 'skipped', reason: `Intent ${intent} does not require research scan.` });
    }

    const shouldLoadIntel = ['query_intelligence', 'generate_briefing', 'general_question'].includes(intent);
    if (shouldLoadIntel) {
      trace.push({ tool: 'query_intelligence', action: 'selected', reason: `Intent ${intent} requests intelligence context.` });
      try {
        const clientName = clientId
          ? await this.prisma.withTenant(ctx.tenantId, (tx) =>
              tx.client.findFirst({ where: { id: clientId }, select: { name: true } }),
            ).then((c) => c?.name ?? undefined)
          : undefined;
        const intelResult = await this.tools.execute(ctx, 'query_intelligence' as never, {
          clientName: clientName ?? undefined,
        });
        const intelData = (intelResult as Record<string, unknown>)?.data;
        if (typeof intelData === 'string' && intelData.length > 10) {
          contextParts.push('\nFederal lobbying intelligence (from Capiro database):');
          contextParts.push(truncateText(intelData, policy.intelChars));
          sources.push({
            tool: 'query_intelligence',
            summary: 'Federal intelligence snapshot loaded',
            confidence: 'high',
          });
        } else {
          trace.push({ tool: 'query_intelligence', action: 'skipped', reason: 'No intelligence text payload returned.' });
        }
      } catch {
        trace.push({ tool: 'query_intelligence', action: 'skipped', reason: 'Intelligence tool request failed.' });
      }
    } else {
      trace.push({ tool: 'query_intelligence', action: 'skipped', reason: `Intent ${intent} does not need intelligence query.` });
    }

    const shouldLoadPublicWeb = ['query_intelligence', 'generate_briefing', 'general_question'].includes(intent);
    if (shouldLoadPublicWeb) {
      trace.push({ tool: 'search_public_web', action: 'selected', reason: `Intent ${intent} may need current public-web corroboration.` });
      try {
        const webResult = await this.tools.execute(ctx, 'search_public_web' as never, {
          query,
          limit: policy.tier === 'deep' ? 6 : 3,
        });
        const webRows = Array.isArray((webResult as { results?: unknown[] }).results)
          ? ((webResult as { results?: unknown[] }).results ?? [])
          : [];
        if (webRows.length) {
          contextParts.push('\nPublic web signals (supplemental to Capiro data):');
          contextParts.push(summarizeJsonForPrompt(webRows, policy.tier === 'deep' ? 2800 : 1400));
          sources.push({
            tool: 'search_public_web',
            count: webRows.length,
            summary: `Loaded ${webRows.length} public web results`,
            confidence: 'low',
          });
        } else {
          trace.push({ tool: 'search_public_web', action: 'skipped', reason: 'No public web results returned.' });
        }
      } catch {
        trace.push({ tool: 'search_public_web', action: 'skipped', reason: 'Public web search failed.' });
      }
    } else {
      trace.push({ tool: 'search_public_web', action: 'skipped', reason: `Intent ${intent} does not require web supplementation.` });
    }

    if (clientId && ['query_clients', 'query_engagement', 'generate_briefing', 'generate_draft'].includes(intent)) {
      trace.push({ tool: 'get_client_context', action: 'selected', reason: `Intent ${intent} needs detailed client context.` });
      try {
        const clientCtx = await this.tools.execute(ctx, 'get_client_context' as never, { clientId });
        const rawCtx = (clientCtx as Record<string, unknown>)?.context;
        if (rawCtx) {
          contextParts.push('\nDetailed client context:');
          contextParts.push(summarizeJsonForPrompt(rawCtx, policy.clientContextChars));
          sources.push({
            tool: 'get_client_context',
            summary: 'Loaded structured client context',
            confidence: 'high',
          });
        } else {
          trace.push({ tool: 'get_client_context', action: 'skipped', reason: 'Client context returned empty payload.' });
        }
      } catch {
        trace.push({ tool: 'get_client_context', action: 'skipped', reason: 'Detailed client context fetch failed.' });
      }
    } else {
      trace.push({ tool: 'get_client_context', action: 'skipped', reason: 'No client-linked deep context required.' });
    }

    const template = this.templateForIntent(intent);
    const conflict = this.detectOrchestratorConflict(query, sources);

    return {
      context: truncateText(contextParts.join('\n'), policy.contextCharBudget),
      sources,
      policy,
      trace,
      conflict,
      template,
    };
  }

  private async classifyIntent(message: string): Promise<string> {
    const anthropicKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
    if (!anthropicKey) return 'general_question';
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 50,
          system: 'You classify user intent for a lobbying AI. Return only JSON: {"intent":"<intent>"}. Valid: query_intelligence, query_clients, query_engagement, query_workflow, edit_draft, edit_workflow_field, generate_draft, generate_briefing, navigate, general_question',
          messages: [{ role: 'user', content: message }],
        }),
      });
      if (res.ok) {
        const json = await res.json() as Record<string, unknown>;
        const text = Array.isArray(json.content) ? (json.content[0] as Record<string, unknown>)?.text : '';
        if (typeof text === 'string') {
          const match = text.match(/"intent"\s*:\s*"([^"]+)"/);
          if (match?.[1]) return match[1];
        }
      }
    } catch { /* fallback */ }
    return 'general_question';
  }

  private buildUnifiedSystemPrompt(
    intent: string,
    context: string,
    template: { heading: string; sections: string[] } | null,
  ): string {
    const base = [
      'You are Clio, an elite AI chief of staff designed exclusively for government affairs professionals.',
      'Your purpose is to maximize a lobbyist\'s efficiency, preparation, and strategic leverage.',
      '',
      'Tone and style requirements:',
      '- Ultra-concise, analytical, objective, authoritative.',
      '- You may be witty only in direct user chat responses.',
      '- Never use witty language in formal drafted content (briefings, memos, emails, reports).',
      '- Never use emoji or emoticons in any response.',
      '- Never use fluff, filler, or moral judgment.',
      '- Strip away idealism and focus on political reality and execution risk.',
      '',
      'Reasoning/output requirements:',
      '- Structure outputs for rapid scanning before high-stakes meetings.',
      '- When analyzing legislation, immediately include:',
      '  1) direct impact,',
      '  2) key stakeholders,',
      '  3) likely opposition,',
      '  4) leverage points / recommended moves.',
      '',
      'Data-source hierarchy (critical):',
      '- Treat Capiro internal sources as primary truth for client/engagement/intelligence questions.',
      '- Public-web results are supplemental only and may be incomplete or noisy.',
      '- If public web conflicts with Capiro internal data, state the discrepancy and prioritize Capiro data unless user asks otherwise.',
      '',
      'You have access to Capiro data including congressional bills, LDA filings, federal spending, engagement records, and firm memory.',
      'Do not fabricate facts. If uncertain, state uncertainty and propose the fastest verification path.',
    ].join('\n');

    const intentGuidance: Record<string, string> = {
      query_intelligence: 'The user is asking about federal lobbying intelligence. You have real data from the Capiro database — bills, LDA filings, spending, and trends. Synthesize this data with clear takeaways. List specific bill numbers, sponsors, and policy areas.',
      query_clients: 'The user is asking about their clients. Use available client data.',
      query_engagement: 'The user is asking about meetings or outreach. Reference engagement records.',
      query_workflow: 'The user is asking about workflows or submissions. Check workflow data.',
      generate_draft: 'Generate a professional government affairs email with proper tone and structure.',
      generate_briefing: 'Create an actionable briefing with key points, risks, and recommendations. Use intelligence data when relevant.',
      general_question: 'Answer helpfully about lobbying, government affairs, or the Capiro platform.',
    };

    const parts = [base];
    if (intentGuidance[intent]) parts.push(`\n${intentGuidance[intent]}`);
    if (template) {
      parts.push(`\nOutput template: ${template.heading}`);
      parts.push(`Required sections: ${template.sections.join(' | ')}`);
    }
    if (context) parts.push(`\nContext:\n${context}`);
    return parts.join('\n');
  }

  private extractStreamControl(rawBody: string): StreamControl {
    let cleanContent = rawBody;

    const tracePattern = /\s*#trace\s*$/i;
    const traceEnabled = tracePattern.test(cleanContent);
    if (traceEnabled) cleanContent = cleanContent.replace(tracePattern, '').trimEnd();

    const pageWritePattern = /^\s*write on this page:\s*/i;
    const pageWriteEnabled = pageWritePattern.test(cleanContent);
    if (pageWriteEnabled) cleanContent = cleanContent.replace(pageWritePattern, '').trimStart();

    return { traceEnabled, cleanContent, pageWriteEnabled };
  }

  private policyForIntent(intent: string, query: string): OrchestratorPolicy {
    const deepIntent = ['generate_briefing', 'query_intelligence', 'generate_draft'].includes(intent);
    const longQuery = query.length > 220;
    const tier: RetrievalTier = deepIntent || longQuery ? 'deep' : 'fast';
    if (tier === 'deep') {
      return {
        tier,
        contextCharBudget: 19_000,
        researchLimit: 18,
        researchChars: 8_500,
        intelChars: 8_500,
        clientContextChars: 7_500,
      };
    }
    return {
      tier,
      contextCharBudget: 9_500,
      researchLimit: 8,
      researchChars: 3_800,
      intelChars: 3_800,
      clientContextChars: 3_500,
    };
  }

  private detectOrchestratorConflict(query: string, sources: ClioSourceAttribution[]): OrchestratorConflict | null {
    const queryKeywords = extractKeywords(query);
    if (!queryKeywords.length || sources.length < 2) return null;

    const highConfidence = sources.filter((source) => confidenceRank(source.confidence) >= 2);
    if (highConfidence.length < 2) return null;

    const coverage = highConfidence.map((source) => {
      const combined = `${source.summary} ${source.tool}`.toLowerCase();
      const matched = queryKeywords.filter((word) => combined.includes(word)).length;
      return { source, matched };
    });

    const maxMatched = Math.max(...coverage.map((item) => item.matched));
    const minMatched = Math.min(...coverage.map((item) => item.matched));
    if (maxMatched - minMatched < 3) return null;

    const weakest = coverage.find((item) => item.matched === minMatched)?.source;
    if (!weakest) return null;

    return {
      title: 'Potential cross-source mismatch',
      detail: `${weakest.tool} appears less aligned with the query than other retrieved sources.`,
    };
  }

  private templateForIntent(intent: string): { heading: string; sections: string[] } | null {
    if (intent === 'generate_briefing') {
      return {
        heading: 'Government Affairs Briefing',
        sections: ['Executive Summary', 'Signal Scan', 'Opportunities', 'Risks', 'Recommended Actions'],
      };
    }
    if (intent === 'generate_draft') {
      return {
        heading: 'Outreach Draft',
        sections: ['Subject Line', 'Opening', 'Core Message', 'Ask / CTA', 'Close'],
      };
    }
    return null;
  }

  private shouldAttemptMemoryLearning(userMessage: string, assistantResponse: string): boolean {
    if (assistantResponse.length < 220) return false;
    const combined = `${userMessage}\n${assistantResponse}`.toLowerCase();
    const noiseMarkers = [
      'error',
      'traceback',
      'http',
      'status code',
      'build failed',
      'typecheck',
      'temporary',
      'for now',
      'todo',
      'next step',
    ];
    if (noiseMarkers.some((marker) => combined.includes(marker))) return false;
    return true;
  }

  private normalizeMemoryCandidate(key: string, value: string): { key: string; value: string } | null {
    const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 200);
    const normalizedValue = value.trim().replace(/\s+/g, ' ').slice(0, 4000);
    if (!normalizedKey || !normalizedValue) return null;

    const volatilePatterns = [
      /\b(today|tomorrow|yesterday|next week|this week)\b/i,
      /\b\d{1,2}:\d{2}\b/,
      /\b(issue|ticket|task)\s*#?\d+/i,
      /\b(temp|temporary|draft only)\b/i,
    ];
    if (volatilePatterns.some((pattern) => pattern.test(normalizedValue))) return null;

    return { key: normalizedKey, value: normalizedValue };
  }

  private classifyMemoryType(key: string, value: string): 'firm' | 'user_private' {
    const combined = `${key} ${value}`.toLowerCase();
    const styleSignals = [
      'writing style',
      'tone',
      'voice',
      'format preference',
      'verbosity',
      'concise',
      'detailed',
      'prefers',
      'communication style',
      'how they write',
    ];
    return styleSignals.some((signal) => combined.includes(signal)) ? 'user_private' : 'firm';
  }

  private userScopedMemoryKey(userId: string, key: string): string {
    return `user:${userId}:${key}`;
  }

  // ── Memory: learn from conversations ──

  private async loadRelevantMemories(
    tenantId: string,
    userId: string,
    query: string,
  ): Promise<Array<{ key: string; value: string }>> {
    try {
      const semantic = await this.semanticMemorySearch(tenantId, userId, query, 8);
      if (semantic.length > 0) {
        return semantic.map(({ key, value }) => ({ key, value }));
      }
    } catch {
      // fall through to keyword strategy
    }

    try {
      const memories = await this.prisma.withTenant(tenantId, (tx) =>
        tx.clioMemory.findMany({
          where: {
            tenantId,
            OR: [
              { scope: 'firm' },
              { scope: 'user_private', ownerUserId: userId },
            ],
          },
          orderBy: { updatedAt: 'desc' },
          take: 20,
          select: { key: true, value: true },
        }),
      );
      const words = extractKeywords(query);
      return memories
        .filter((m) => {
          const combined = `${m.key} ${m.value}`.toLowerCase();
          return words.some((w) => combined.includes(w));
        })
        .slice(0, 8);
    } catch {
      return [];
    }
  }

  private async maybeLearnFromConversation(
    tenantId: string,
    userId: string,
    conversationId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    if (!this.shouldAttemptMemoryLearning(userMessage, assistantResponse)) return;

    const anthropicKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
    if (!anthropicKey) return;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          system:
            'Extract 0-3 durable facts from this conversation exchange. Split outputs into either firm-level institutional facts or user-specific writing/tone preferences. Ignore temporary statuses, one-off tasks, runtime errors, specific timestamps, and operational chatter. Return JSON: {"memories":[{"key":"short_label","value":"fact to remember"}]}. Return {"memories":[]} if nothing worth remembering.',
          messages: [{ role: 'user', content: `User: ${userMessage}\n\nAssistant: ${assistantResponse}` }],
        }),
      });

      if (!res.ok) return;
      const json = (await res.json()) as Record<string, unknown>;
      const text = Array.isArray(json.content) ? (json.content[0] as Record<string, unknown>)?.text : '';
      if (typeof text !== 'string') return;

      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return;
      const parsed = JSON.parse(match[0]) as { memories?: Array<{ key?: unknown; value?: unknown }> };
      if (!Array.isArray(parsed.memories)) return;

      for (const mem of parsed.memories) {
        if (typeof mem.key !== 'string' || typeof mem.value !== 'string') continue;
        const normalized = this.normalizeMemoryCandidate(mem.key, mem.value);
        if (!normalized) continue;

        const memoryType = this.classifyMemoryType(normalized.key, normalized.value);
        const keyWithoutPrefix = memoryType === 'user_private' ? this.userScopedMemoryKey(userId, normalized.key) : normalized.key;
        const scope = memoryType;
        const ownerUserId = scope === 'user_private' ? userId : null;
        const storedKey = keyWithoutPrefix;
        const source = scope === 'user_private' ? 'user_style' : 'firm';
        const memoryMetadata = {
          conversationId,
          updatedBy: 'auto',
          userId,
          visibility: scope,
        };

        const existing = await this.prisma.withTenant(tenantId, (tx) =>
          tx.clioMemory.findFirst({
            where: {
              tenantId,
              scope,
              ownerUserId,
              key: storedKey,
            },
          }),
        );

        if (existing) {
          await this.prisma.withTenant(tenantId, (tx) =>
            tx.clioMemory.update({
              where: { id: existing.id },
              data: {
                value: normalized.value,
                source,
                metadata: memoryMetadata,
              },
            }),
          );
        } else {
          await this.prisma.withTenant(tenantId, (tx) =>
            tx.clioMemory.create({
              data: {
                tenantId,
                scope,
                ownerUserId,
                key: storedKey,
                value: normalized.value,
                source,
                metadata: { ...memoryMetadata, createdBy: 'auto' },
              },
            }),
          );
        }

        void this.embedAndStoreMemory(tenantId, storedKey, normalized.value).catch(() => {});
      }
    } catch (err) {
      this.logger.debug(`Memory extraction failed: ${(err as Error).message}`);
    }
  }

  // ── Proactive Alerts ──────────────────────────────────────────────────

  async listAlerts(ctx: TenantContext) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioProactiveAlert.findMany({
        where: { tenantId: ctx.tenantId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          alertType: true,
          title: true,
          body: true,
          priority: true,
          status: true,
          clientId: true,
          createdAt: true,
        },
      }),
    );
  }

  async dismissAlert(ctx: TenantContext, alertId: string) {
    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioProactiveAlert.updateMany({
        where: { id: alertId, tenantId: ctx.tenantId },
        data: { status: 'read', readAt: new Date() },
      }),
    );
  }

  // ── Artifact Versioning ───────────────────────────────────────────────

  async createArtifactVersion(ctx: TenantContext, parentId: string, bodyText: string) {
    const parent = await this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioArtifact.findFirst({
        where: { id: parentId, tenantId: ctx.tenantId },
      }),
    );
    if (!parent) throw new NotFoundException('Artifact not found');

    return this.prisma.withTenant(ctx.tenantId, (tx) =>
      tx.clioArtifact.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          clientId: parent.clientId,
          conversationId: parent.conversationId,
          parentArtifactId: parent.id,
          title: parent.title,
          kind: parent.kind,
          contentType: parent.contentType,
          bodyText,
          metadata: { versionOf: parent.id, editedBy: ctx.userId },
        },
      }),
    );
  }

  // ── Proactive Alert Generation ────────────────────────────────────────
  // Called on each stream response to check if anything warrants a proactive alert.
  // Also callable externally for scheduled scans.

  async generateProactiveAlerts(tenantId: string): Promise<number> {
    let created = 0;
    try {
      // 1. Upcoming meetings without prep (next 48 hours)
      const tomorrow = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const upcomingMeetings = await this.prisma.withSystem((tx) =>
        tx.meeting.findMany({
          where: {
            tenantId,
            startsAt: { gte: new Date(), lte: tomorrow },
            preps: { none: {} },
          },
          select: { id: true, subject: true, startsAt: true, clientId: true, client: { select: { name: true } } },
          take: 5,
        }),
      );

      for (const meeting of upcomingMeetings) {
        const exists = await this.prisma.withSystem((tx) =>
          tx.clioProactiveAlert.findFirst({
            where: { tenantId, sourceType: 'meeting_prep', sourceId: meeting.id, status: 'pending' },
          }),
        );
        if (!exists) {
          await this.prisma.withSystem((tx) =>
            tx.clioProactiveAlert.create({
              data: {
                tenantId,
                clientId: meeting.clientId,
                alertType: 'meeting_prep_needed',
                title: `Meeting prep needed: ${meeting.subject}`,
                body: `Your meeting "${meeting.subject}"${meeting.client?.name ? ` with ${meeting.client.name}` : ''} is in less than 48 hours and has no prep notes. Ask Clio to create a meeting brief.`,
                priority: 'high',
                sourceType: 'meeting_prep',
                sourceId: meeting.id,
                metadata: { meetingId: meeting.id, startsAt: meeting.startsAt.toISOString() },
              },
            }),
          );
          created++;
        }
      }

      // 2. Clients with no recent engagement (30+ days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const staleClients = await this.prisma.withSystem((tx) =>
        tx.client.findMany({
          where: {
            tenantId,
            status: 'active',
            meetings: { none: { startsAt: { gte: thirtyDaysAgo } } },
          },
          select: { id: true, name: true },
          take: 5,
        }),
      );

      for (const client of staleClients) {
        const exists = await this.prisma.withSystem((tx) =>
          tx.clioProactiveAlert.findFirst({
            where: { tenantId, sourceType: 'stale_client', sourceId: client.id, status: 'pending' },
          }),
        );
        if (!exists) {
          await this.prisma.withSystem((tx) =>
            tx.clioProactiveAlert.create({
              data: {
                tenantId,
                clientId: client.id,
                alertType: 'client_activity',
                title: `No recent activity: ${client.name}`,
                body: `${client.name} hasn't had a meeting or engagement in over 30 days. Consider scheduling a check-in.`,
                priority: 'normal',
                sourceType: 'stale_client',
                sourceId: client.id,
                metadata: {},
              },
            }),
          );
          created++;
        }
      }
    } catch (err) {
      this.logger.warn(`Alert generation failed: ${(err as Error).message}`);
    }
    return created;
  }

  // ── Embedding-based memory search (Phase 4 semantic) ──────────────────

  async embedAndStoreMemory(tenantId: string, key: string, value: string): Promise<void> {
    const anthropicKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
    // Use OpenAI for embeddings (1536-dim text-embedding-3-small)
    const openaiKey = this.config.get('OPENAI_API_KEY', { infer: true });
    if (!openaiKey) return;

    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: `${key}: ${value}` }),
      });
      if (!res.ok) return;
      const json = await res.json() as { data?: Array<{ embedding?: number[] }> };
      const embedding = json.data?.[0]?.embedding;
      if (!embedding || embedding.length !== 1536) return;

      const vecStr = `[${embedding.join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `UPDATE clio_memory SET embedding = $1::vector WHERE tenant_id = $2 AND key = $3`,
        vecStr, tenantId, key,
      );
    } catch (err) {
      this.logger.debug(`Embedding failed for memory ${key}: ${(err as Error).message}`);
    }
  }

  async semanticMemorySearch(
    tenantId: string,
    userId: string,
    query: string,
    limit = 5,
  ): Promise<Array<{ key: string; value: string; score: number }>> {
    const openaiKey = this.config.get('OPENAI_API_KEY', { infer: true });
    if (!openaiKey) return [];

    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: query }),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
      const embedding = json.data?.[0]?.embedding;
      if (!embedding || embedding.length !== 1536) return [];

      const vecStr = `[${embedding.join(',')}]`;
      const results = await this.prisma.$queryRawUnsafe<Array<{ key: string; value: string; score: number }>>(
        `SELECT key, value, 1 - (embedding <=> $1::vector) as score
         FROM clio_memory
         WHERE tenant_id = $2
           AND embedding IS NOT NULL
           AND (
             scope = 'firm'
             OR (scope = 'user_private' AND owner_user_id = $3::uuid)
           )
         ORDER BY embedding <=> $1::vector
         LIMIT $4`,
        vecStr,
        tenantId,
        userId,
        limit,
      );
      return results.filter((r) => r.score > 0.3);
    } catch (err) {
      this.logger.debug(`Semantic search failed: ${(err as Error).message}`);
      return [];
    }
  }
}

function normalizeRuntimeMessagesFromChatCompletion(
  response: RuntimeChatCompletionResponse,
): ReturnType<typeof normalizeRuntimeMessages> {
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const firstChoice = choices[0] as RuntimeChatChoice | undefined;
  const message =
    firstChoice?.message && typeof firstChoice.message === 'object'
      ? (firstChoice.message as RuntimeChatMessage)
      : null;
  const body = firstString(message?.content);
  if (!body) return [];
  return [
    {
      role: 'assistant',
      body,
      nanoclawId: typeof response.id === 'string' ? response.id : null,
      metadata: jsonObjectOrEmpty({
        runtime: RUNTIME_NAME,
        finishReason: firstChoice?.finish_reason,
        usage: response.usage,
        hermes: response.hermes,
      }),
      artifacts: [],
    },
  ];
}

function normalizeRuntimeMessages(raw: unknown): Array<{
  role: 'assistant' | 'tool' | 'system';
  body: string;
  nanoclawId: string | null;
  metadata: Prisma.InputJsonValue;
  artifacts: Array<{
    title: string;
    kind: string;
    contentType: string | null;
    bodyText: string | null;
    s3Key: string | null;
    metadata: Prisma.InputJsonValue;
  }>;
}> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((message): ReturnType<typeof normalizeRuntimeMessages>[number] | null => {
      if (!message || typeof message !== 'object') return null;
      const m = message as RuntimeMessage;
      const body = firstString(m.body, m.text, m.markdown, m.content);
      if (!body) return null;
      const role = normalizeRole(m.role);
      return {
        role,
        body,
        nanoclawId: typeof m.id === 'string' ? m.id : null,
        metadata: jsonObjectOrEmpty(m.metadata),
        artifacts: normalizeRuntimeArtifacts(m.artifacts),
      };
    })
    .filter((message): message is NonNullable<typeof message> => Boolean(message));
}

function normalizeRuntimeArtifacts(raw: unknown): Array<{
  title: string;
  kind: string;
  contentType: string | null;
  bodyText: string | null;
  s3Key: string | null;
  metadata: Prisma.InputJsonValue;
}> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((artifact): ReturnType<typeof normalizeRuntimeArtifacts>[number] | null => {
      if (!artifact || typeof artifact !== 'object') return null;
      const a = artifact as RuntimeArtifact;
      const bodyText = firstString(a.bodyText, a.body, a.content);
      const s3Key = typeof a.s3Key === 'string' ? a.s3Key : null;
      if (!bodyText && !s3Key) return null;
      return {
        title: firstString(a.title) ?? 'Clio artifact',
        kind: firstString(a.kind) ?? 'document',
        contentType: firstString(a.contentType),
        bodyText,
        s3Key,
        metadata: jsonObjectOrEmpty(a.metadata),
      };
    })
    .filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact));
}

function normalizeRole(value: unknown): 'assistant' | 'tool' | 'system' {
  return value === 'tool' || value === 'system' ? value : 'assistant';
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function jsonObjectOrEmpty(value: unknown): Prisma.InputJsonValue {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Prisma.InputJsonObject;
  }
  return {};
}

function titleFromMessage(body: string): string {
  const firstLine = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return 'New Clio session';
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

function summarizeJsonForPrompt(value: unknown, maxChars = 5000): string {
  try {
    const text = JSON.stringify(value, null, 2);
    if (!text) return '';
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}\n... [truncated ${text.length - maxChars} chars]`;
  } catch {
    return '';
  }
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... [truncated ${text.length - maxChars} chars]`;
}

function confidenceRank(confidence: ConfidenceLevel): number {
  switch (confidence) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    default:
      return 1;
  }
}

function extractKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 5),
    ),
  ).slice(0, 20);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
