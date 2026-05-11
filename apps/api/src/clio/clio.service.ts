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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
