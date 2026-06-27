import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TenantContext } from '@capiro/shared';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EngagementService, UpdateOutreachRecordInput } from '../engagement/engagement.service.js';
import { ChatToolsService } from './chat-tools.service.js';
import type {
  SendMessageDto,
  EditDraftDto,
} from './dto/chat-message.dto.js';

const AI_TIMEOUT_MS = 90_000;
const CHAT_HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const CHAT_SONNET_MODEL = 'claude-sonnet-4-6';

type ChatIntent =
  | 'query_intelligence'
  | 'query_clients'
  | 'query_engagement'
  | 'edit_draft'
  | 'generate_draft'
  | 'generate_briefing'
  | 'general_question'
  | 'navigate';

// Duck-typed interface for SSE response writing, satisfied by express.Response
interface SseWriter {
  write(chunk: string): void;
}

// Prisma client extended with the new ChatMessage model
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ServiceUnavailableException(`AI provider timed out after ${AI_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function extractAnthropicText(json: Record<string, unknown>): string {
  const content = Array.isArray(json.content) ? json.content : [];
  return content
    .map((part) => {
      const r =
        part && typeof part === 'object' && !Array.isArray(part)
          ? (part as Record<string, unknown>)
          : {};
      return r.type === 'text' && typeof r.text === 'string' ? r.text : '';
    })
    .join('\n')
    .trim();
}

function extractOpenAiText(json: Record<string, unknown>): string {
  if (typeof json.output_text === 'string') return json.output_text;
  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as unknown[])
      : [];
    for (const part of content) {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === 'string') return text;
    }
  }
  return '';
}

function parseJsonSafe(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly openaiKey?: string;
  private readonly anthropicKey?: string;
  private readonly preferredProvider?: 'openai' | 'anthropic';
  private readonly openaiModel: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly tools: ChatToolsService,
    private readonly engagementService: EngagementService,
  ) {
    this.openaiKey = config.get('OPENAI_API_KEY', { infer: true });
    this.anthropicKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.preferredProvider = config.get('AI_PROVIDER', { infer: true });
    this.openaiModel = config.get('OPENAI_MODEL', { infer: true });
  }

  // Accessor for the Prisma chatMessage delegate (available after prisma generate)
  private get chatMessage() {
    return (this.prisma as AnyPrisma).chatMessage as {
      create: (args: unknown) => Promise<unknown>;
      findMany: (args: unknown) => Promise<Array<{ id: string; role: string; content: string; createdAt: Date; metadata: unknown }>>;
      deleteMany: (args: unknown) => Promise<{ count: number }>;
    };
  }

  // ─── Session management ───────────────────────────────────────────────────

  async createSession(ctx: TenantContext): Promise<{ sessionId: string }> {
    const sessionId = crypto.randomUUID();
    const systemContent = [
      'You are Capiro AI, a federal lobbying intelligence assistant embedded in the Capiro platform.',
      'You help government affairs professionals manage clients, meetings, outreach, workflows, and intelligence.',
      'Be concise, professional, and context-aware.',
    ].join(' ');

    await this.chatMessage.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        role: 'system',
        content: systemContent,
        sessionId,
        metadata: { type: 'session_init' },
      },
    });

    return { sessionId };
  }

  async getHistory(ctx: TenantContext, sessionId: string) {
    return this.chatMessage.findMany({
      where: { tenantId: ctx.tenantId, userId: ctx.userId, sessionId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true, metadata: true },
    });
  }

  async deleteSession(ctx: TenantContext, sessionId: string): Promise<{ deleted: boolean }> {
    const result = await this.chatMessage.deleteMany({
      where: { tenantId: ctx.tenantId, userId: ctx.userId, sessionId },
    });
    if (result.count === 0) throw new NotFoundException(`Session '${sessionId}' not found`);
    return { deleted: true };
  }

  // ─── Main streaming message endpoint ─────────────────────────────────────

  async streamMessage(ctx: TenantContext, dto: SendMessageDto, sse: SseWriter): Promise<void> {
    const { content, sessionId, context } = dto;

    // Store user message
    await this.chatMessage.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        role: 'user',
        content,
        sessionId,
        metadata: context ?? null,
      },
    });

    // Load recent conversation history
    const history = await this.chatMessage.findMany({
      where: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        sessionId,
        role: { in: ['user', 'assistant'] },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { role: true, content: true },
    });

    // Classify intent with Haiku (fast + cheap)
    const intent = await this.classifyIntent(content, context?.page);
    this.logger.debug(`Intent: ${intent} | message: "${content.slice(0, 80)}"`);

    // Gather relevant context in parallel
    const [pageContext, toolContext] = await Promise.all([
      this.tools.gatherPageContext(ctx.tenantId, context),
      this.gatherToolContext(ctx.tenantId, intent, context),
    ]);

    const systemPrompt = this.buildSystemPrompt(intent, pageContext, toolContext);

    sse.write(`data: ${JSON.stringify({ type: 'start', intent })}\n\n`);

    let assistantContent = '';
    try {
      assistantContent = await this.streamResponse(systemPrompt, history as Array<{ role: string; content: string }>, content, sse);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI generation failed';
      sse.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
      assistantContent = `I encountered an error generating a response: ${msg}`;
    }

    // Persist assistant response
    await this.chatMessage.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        role: 'assistant',
        content: assistantContent,
        sessionId,
        metadata: { intent },
      },
    });

    sse.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  }

  // ─── Edit draft (non-streaming, saves to DB) ──────────────────────────────

  async editDraft(ctx: TenantContext, dto: EditDraftDto) {
    const { engagementId, currentSubject, currentBody, instruction, context } = dto;

    const pageContext = await this.tools.gatherPageContext(ctx.tenantId, context);

    const prompt = [
      'Edit the following outreach email draft per the instruction.',
      'Preserve the intent and key points unless the instruction explicitly changes them.',
      'Return valid JSON with "subject", "body", and "changesSummary" fields.',
      '',
      pageContext ? `Context:\n${pageContext}` : '',
      `Instruction: ${instruction}`,
      '',
      `Current subject: ${currentSubject}`,
      `Current body:\n${currentBody}`,
    ]
      .filter(Boolean)
      .join('\n');

    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['subject', 'body', 'changesSummary'],
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
        changesSummary: { type: 'string' },
      },
    };

    const result = await this.callWithProviderFallback<{
      subject: string;
      body: string;
      changesSummary: string;
    }>('draft edit', async (provider) => {
      if (provider === 'anthropic') {
        if (!this.anthropicKey) throw new ServiceUnavailableException('ANTHROPIC_API_KEY not configured');
        const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': this.anthropicKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: CHAT_SONNET_MODEL,
            max_tokens: 3000,
            system:
              'You are an expert government affairs writer. Edit the provided email draft per the instruction. Return only valid JSON.',
            messages: [
              { role: 'user', content: `${prompt}\n\nJSON schema:\n${JSON.stringify(schema)}` },
            ],
          }),
        });
        const json = (await res.json()) as Record<string, unknown>;
        if (!res.ok)
          throw new ServiceUnavailableException(`Anthropic draft edit failed: HTTP ${res.status}`);
        const parsed = parseJsonSafe(extractAnthropicText(json));
        return {
          subject: typeof parsed.subject === 'string' ? parsed.subject : currentSubject,
          body: typeof parsed.body === 'string' ? parsed.body : currentBody,
          changesSummary:
            typeof parsed.changesSummary === 'string' ? parsed.changesSummary : 'Changes applied.',
        };
      } else {
        if (!this.openaiKey) throw new ServiceUnavailableException('OPENAI_API_KEY not configured');
        const res = await fetchWithTimeout('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.openaiModel,
            input: `${prompt}\n\nJSON schema:\n${JSON.stringify(schema)}`,
            text: { format: { type: 'json_schema', name: 'draft_edit', strict: true, schema } },
          }),
        });
        const json = (await res.json()) as Record<string, unknown>;
        if (!res.ok)
          throw new ServiceUnavailableException(`OpenAI draft edit failed: HTTP ${res.status}`);
        const parsed = parseJsonSafe(extractOpenAiText(json));
        return {
          subject: typeof parsed.subject === 'string' ? parsed.subject : currentSubject,
          body: typeof parsed.body === 'string' ? parsed.body : currentBody,
          changesSummary:
            typeof parsed.changesSummary === 'string' ? parsed.changesSummary : 'Changes applied.',
        };
      }
    });

    // Persist updated draft via EngagementService
    const update: UpdateOutreachRecordInput = { subject: result.subject, body: result.body };
    await this.engagementService.updateOutreachRecord(ctx, engagementId, update);

    return result;
  }

  // ─── Private: intent classification ──────────────────────────────────────

  private async classifyIntent(message: string, page?: string): Promise<ChatIntent> {
    const prompt = [
      'Classify the user message for a federal lobbying AI assistant. Return JSON: {"intent": "<intent>"}',
      '',
      'Valid intents:',
      'query_intelligence, questions about bills, lobbying data, federal spending, regulatory changes',
      'query_clients, questions about the user\'s CRM clients',
      'query_engagement, questions about meetings, emails, outreach records',
      'edit_draft, editing an existing outreach email draft',
      'generate_draft, generating a new outreach email or communication',
      'generate_briefing, requesting a briefing or summary about a client or topic',
      'navigate, asking to navigate to a different page or section',
      'general_question, anything else about lobbying, government affairs, or the platform',
      '',
      page ? `Current page: ${page}` : '',
      `User message: "${message}"`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      if (this.anthropicKey) {
        const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': this.anthropicKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: CHAT_HAIKU_MODEL,
            max_tokens: 50,
            system: 'You classify user intent. Return only valid JSON with an "intent" field.',
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as Record<string, unknown>;
          const parsed = parseJsonSafe(extractAnthropicText(json));
          if (typeof parsed.intent === 'string') return parsed.intent as ChatIntent;
        }
      }

      if (this.openaiKey) {
        const intentSchema = {
          type: 'object',
          additionalProperties: false,
          required: ['intent'],
          properties: { intent: { type: 'string' } },
        };
        const res = await fetchWithTimeout('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.openaiModel,
            input: prompt,
            text: { format: { type: 'json_schema', name: 'intent', strict: true, schema: intentSchema } },
          }),
        });
        if (res.ok) {
          const json = (await res.json()) as Record<string, unknown>;
          const parsed = parseJsonSafe(extractOpenAiText(json));
          if (typeof parsed.intent === 'string') return parsed.intent as ChatIntent;
        }
      }
    } catch (err) {
      this.logger.warn(
        `Intent classification failed, defaulting to general_question: ${(err as Error).message}`,
      );
    }

    return 'general_question';
  }

  // ─── Private: tool context gathering ─────────────────────────────────────

  private async gatherToolContext(
    tenantId: string,
    intent: ChatIntent,
    context?: { clientId?: string; clientName?: string },
  ): Promise<string> {
    try {
      switch (intent) {
        case 'query_clients':
          return this.tools.queryClients(tenantId);
        case 'query_engagement':
          return this.tools.queryEngagementOutreach(tenantId, context?.clientId);
        case 'query_intelligence':
        case 'generate_briefing':
          return this.tools.queryIntelligence(context?.clientName);
        default:
          return '';
      }
    } catch (err) {
      this.logger.warn(
        `Tool context failed for intent ${intent}: ${(err as Error).message}`,
      );
      return '';
    }
  }

  // ─── Private: system prompt builder ──────────────────────────────────────

  private buildSystemPrompt(intent: ChatIntent, pageContext: string, toolContext: string): string {
    const base =
      'You are Capiro AI, an expert federal lobbying intelligence assistant embedded in the Capiro platform. ' +
      'You assist government affairs professionals with client management, congressional outreach, intelligence analysis, and workflow submissions. ' +
      'Be concise, professional, and accurate. Do not invent facts.';

    const intentGuidance: Partial<Record<ChatIntent, string>> = {
      query_intelligence:
        'The user is asking about federal lobbying intelligence. Synthesize the provided data to answer clearly.',
      query_clients: 'The user is asking about their clients. Use the client list provided.',
      query_engagement:
        'The user is asking about meetings or outreach activity. Use the engagement data provided.',
      generate_draft:
        'Generate a professional government affairs outreach email using any context provided.',
      generate_briefing:
        'Synthesize the provided intelligence into a clear, actionable briefing with key points.',
      navigate:
        'Explain where to find what the user is looking for within the Capiro platform: Engagement Manager (meetings, outreach), Intelligence Center (lobbying/spending data), Clients.',
      general_question:
        "Answer the user's question about federal lobbying, government affairs, or the Capiro platform.",
    };

    const parts = [base];
    if (intentGuidance[intent]) parts.push(intentGuidance[intent]!);
    if (pageContext) parts.push(`\nPage context:\n${pageContext}`);
    if (toolContext) parts.push(`\nRelevant data:\n${toolContext}`);

    return parts.join('\n');
  }

  // ─── Private: streaming response dispatcher ───────────────────────────────

  private async streamResponse(
    systemPrompt: string,
    history: Array<{ role: string; content: string }>,
    newUserMessage: string,
    sse: SseWriter,
  ): Promise<string> {
    const messages = [
      ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: newUserMessage },
    ];

    // Anthropic first (unless explicitly preferring OpenAI)
    if (this.anthropicKey && this.preferredProvider !== 'openai') {
      try {
        return await this.streamFromAnthropic(systemPrompt, messages, sse);
      } catch (err) {
        this.logger.warn(
          `Anthropic streaming failed, falling back to OpenAI: ${(err as Error).message}`,
        );
      }
    }

    if (this.openaiKey) {
      return this.generateFromOpenAi(systemPrompt, messages, sse);
    }

    if (this.anthropicKey) {
      return this.streamFromAnthropic(systemPrompt, messages, sse);
    }

    throw new ServiceUnavailableException(
      'No AI provider configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.',
    );
  }

  private async streamFromAnthropic(
    systemPrompt: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    sse: SseWriter,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.anthropicKey!,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: CHAT_SONNET_MODEL,
          max_tokens: 2000,
          stream: true,
          system: systemPrompt,
          messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        const errMsg =
          typeof errJson.error === 'object' && errJson.error !== null
            ? String((errJson.error as Record<string, unknown>).message ?? '')
            : '';
        throw new ServiceUnavailableException(
          `Anthropic chat failed: ${errMsg || `HTTP ${response.status}`}`,
        );
      }

      let fullText = '';
      const decoder = new TextDecoder();
      const body = response.body as unknown as AsyncIterable<Uint8Array>;
      let buffer = '';

      for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const evt = JSON.parse(payload) as Record<string, unknown>;
            if (evt.type === 'content_block_delta') {
              const delta = (evt.delta ?? {}) as Record<string, unknown>;
              if (delta.type === 'text_delta' && typeof delta.text === 'string') {
                fullText += delta.text;
                sse.write(`data: ${JSON.stringify({ type: 'text', text: delta.text })}\n\n`);
              }
            }
          } catch {
            // incomplete SSE chunk, skip
          }
        }
      }

      return fullText;
    } finally {
      clearTimeout(timer);
    }
  }

  private async generateFromOpenAi(
    systemPrompt: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    sse: SseWriter,
  ): Promise<string> {
    const conversationText = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.openaiModel,
        instructions: systemPrompt,
        input: conversationText,
      }),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const err =
        (json.error as Record<string, unknown> | undefined)?.message ?? `HTTP ${response.status}`;
      throw new ServiceUnavailableException(`OpenAI chat failed: ${String(err)}`);
    }

    const text = extractOpenAiText(json);
    if (text) {
      sse.write(`data: ${JSON.stringify({ type: 'text', text: text })}\n\n`);
    }
    return text;
  }

  // ─── Private: provider fallback wrapper ──────────────────────────────────

  private async callWithProviderFallback<T>(
    operation: string,
    invoke: (provider: 'openai' | 'anthropic') => Promise<T>,
  ): Promise<T> {
    const providers: Array<'openai' | 'anthropic'> = [];
    const add = (p: 'openai' | 'anthropic') => {
      const has = p === 'openai' ? this.openaiKey : this.anthropicKey;
      if (has && !providers.includes(p)) providers.push(p);
    };
    if (this.preferredProvider) add(this.preferredProvider);
    add('anthropic');
    add('openai');

    if (!providers.length) {
      throw new ServiceUnavailableException(
        `${operation} is not configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.`,
      );
    }

    const failures: string[] = [];
    for (const provider of providers) {
      try {
        return await invoke(provider);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'provider failed';
        failures.push(`${provider}: ${msg}`);
        if (provider !== providers[providers.length - 1]) {
          this.logger.warn(`${operation} failed with ${provider}, trying fallback: ${msg}`);
        }
      }
    }

    throw new ServiceUnavailableException(
      `${operation} failed for all providers. ${failures.join(' | ')}`,
    );
  }
}
