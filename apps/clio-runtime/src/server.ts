import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

type JsonObject = Record<string, unknown>;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface CapiroContext {
  tenant?: JsonObject;
  user?: JsonObject;
  conversation?: { id?: unknown; clientId?: unknown };
  capiroTools?: {
    runtimeEndpoint?: unknown;
    conversationId?: unknown;
  };
}

interface RuntimeArtifact {
  title: string;
  kind: string;
  contentType: string | null;
  bodyText: string | null;
  s3Key: string | null;
  metadata: JsonObject;
}

const host = process.env.API_SERVER_HOST || '0.0.0.0';
const port = Number(process.env.API_SERVER_PORT || 8642);
const advertisedModel = process.env.API_SERVER_MODEL_NAME || 'clio';
const hermesHome = process.env.HERMES_HOME || '/opt/data';
const apiKey = process.env.API_SERVER_KEY || '';
const capiroBackendBaseUrl = process.env.CAPIRO_BACKEND_BASE_URL || '';
const openaiKey = process.env.OPENAI_API_KEY || '';
const anthropicKey = process.env.ANTHROPIC_API_KEY || '';
const openaiModel = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('Unhandled request error', error);
    writeJson(res, 500, { error: { message: messageOf(error), type: 'server_error' } });
  });
});

server.listen(port, host, () => {
  console.log(`Clio runtime listening on ${host}:${port}`);
});

async function handle(req: IncomingMessage, res: ServerResponse) {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (method === 'GET' && (url.pathname === '/health' || url.pathname === '/v1/health')) {
    writeJson(res, 200, {
      status: 'ok',
      brand: 'Clio',
      runtime: 'clio-agent-runtime',
      model: advertisedModel,
      providers: {
        openai: Boolean(openaiKey),
        anthropic: Boolean(anthropicKey),
      },
    });
    return;
  }

  if (method === 'GET' && url.pathname === '/v1/models') {
    if (!authorized(req)) return unauthorized(res);
    writeJson(res, 200, {
      object: 'list',
      data: [{ id: advertisedModel, object: 'model', owned_by: 'capiro' }],
    });
    return;
  }

  if (method === 'POST' && url.pathname === '/v1/chat/completions') {
    if (!authorized(req)) return unauthorized(res);
    try {
      const body = await readJson(req);
      const result = await chatCompletion(body, req);
      writeJson(res, 200, result.body, result.headers);
    } catch (error) {
      if (error instanceof HttpError) {
        writeJson(res, error.status, { error: { message: error.message, type: 'runtime_error' } });
        return;
      }
      throw error;
    }
    return;
  }

  writeJson(res, 404, { error: { message: 'Not found', type: 'not_found' } });
}

async function chatCompletion(raw: JsonObject, req: IncomingMessage) {
  const requestMessages = Array.isArray(raw.messages) ? raw.messages : [];
  const messages = requestMessages
    .map((item) => normalizeMessage(item))
    .filter((item): item is ChatMessage => Boolean(item));
  const systemText = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content || '')
    .join('\n');
  const userText =
    [...messages].reverse().find((message) => message.role === 'user')?.content?.trim() || '';
  if (!userText) {
    throw new HttpError(400, 'No user message found in messages');
  }

  const context = extractCapiroContext(systemText);
  const sessionId = header(req, 'x-hermes-session-id') || stringValue(context.conversation?.id) || randomUUID();
  const sessionKey = header(req, 'x-hermes-session-key') || null;
  const artifacts: RuntimeArtifact[] = [];

  const providerMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        "You are Clio, Capiro's private workspace assistant for lobbying teams.",
        'Use only the supplied Capiro context and authorized tool results. Do not invent tenant, user, client, meeting, note, or source data.',
        'When creating an artifact, prefer the provided Capiro tools so the artifact is persisted with tenant/user/client scope.',
        systemText,
      ].join('\n\n'),
    },
    { role: 'user', content: userText },
  ];

  const completion = openaiKey
    ? await completeWithOpenAi(providerMessages, context, artifacts)
    : await completeWithAnthropic(providerMessages);

  await persistSessionEvent(sessionId, {
    at: new Date().toISOString(),
    sessionKey,
    tenant: context.tenant,
    user: context.user,
    input: userText,
    output: completion.content,
    artifacts: artifacts.map((artifact) => ({ title: artifact.title, kind: artifact.kind })),
  });

  return {
    headers: {
      'X-Hermes-Session-Id': sessionId,
      ...(sessionKey ? { 'X-Hermes-Session-Key': sessionKey } : {}),
    },
    body: {
      id: `chatcmpl-${randomUUID().replace(/-/g, '')}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: advertisedModel,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: completion.content },
          finish_reason: completion.finishReason,
        },
      ],
      usage: completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      artifacts,
    },
  };
}

async function completeWithOpenAi(
  initialMessages: ChatMessage[],
  context: CapiroContext,
  artifacts: RuntimeArtifact[],
) {
  const messages: ChatMessage[] = [...initialMessages];
  let lastUsage: unknown = null;

  for (let round = 0; round < 5; round += 1) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: openaiModel,
        messages,
        tools: capiroToolSchemas(),
        tool_choice: 'auto',
        temperature: 0.2,
      }),
    });
    const json = (await response.json()) as JsonObject;
    if (!response.ok) throw new HttpError(502, `OpenAI request failed: ${providerError(json, response.status)}`);
    lastUsage = json.usage;

    const choice = arrayValue(json.choices)[0] as JsonObject | undefined;
    const message = objectValue(choice?.message);
    const toolCalls = arrayValue(message.tool_calls)
      .map((item) => normalizeToolCall(item))
      .filter((item): item is ToolCall => Boolean(item));
    const content = stringValue(message.content);

    if (toolCalls.length) {
      messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls,
      });
      for (const toolCall of toolCalls) {
        const result = await executeCapiroTool(context, toolCall);
        artifacts.push(...extractArtifacts(result));
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      continue;
    }

    if (!content) throw new HttpError(502, 'OpenAI returned an empty Clio response');
    return { content, finishReason: stringValue(choice?.finish_reason) || 'stop', usage: lastUsage };
  }

  throw new HttpError(502, 'Clio exceeded the maximum tool-call rounds');
}

async function completeWithAnthropic(messages: ChatMessage[]) {
  if (!anthropicKey) throw new HttpError(503, 'No LLM provider is configured for Clio runtime');
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const user = messages.filter((message) => message.role === 'user').map((message) => message.content).join('\n\n');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 2200,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const json = (await response.json()) as JsonObject;
  if (!response.ok) throw new HttpError(502, `Anthropic request failed: ${providerError(json, response.status)}`);
  const content = arrayValue(json.content)
    .map((part) => objectValue(part))
    .map((part) => (part.type === 'text' ? stringValue(part.text) : null))
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .trim();
  if (!content) throw new HttpError(502, 'Anthropic returned an empty Clio response');
  return { content, finishReason: 'stop', usage: json.usage };
}

async function executeCapiroTool(context: CapiroContext, toolCall: ToolCall) {
  if (!capiroBackendBaseUrl) {
    return { error: 'CAPIRO_BACKEND_BASE_URL is not configured for tool execution' };
  }
  const endpointTemplate = stringValue(context.capiroTools?.runtimeEndpoint) || '/api/clio/runtime/tools/{toolName}';
  const conversationId = stringValue(context.capiroTools?.conversationId) || stringValue(context.conversation?.id);
  const args = parseToolArguments(toolCall.function.arguments);
  if (conversationId && !args.conversationId) args.conversationId = conversationId;
  if (!args.clientId && typeof context.conversation?.clientId === 'string') args.clientId = context.conversation.clientId;

  const endpoint = endpointTemplate.replace('{toolName}', encodeURIComponent(toolCall.function.name));
  const url = new URL(endpoint, capiroBackendBaseUrl.endsWith('/') ? capiroBackendBaseUrl : `${capiroBackendBaseUrl}/`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  const payload = text ? safeJson(text) : {};
  if (!response.ok) {
    return { error: `Capiro tool ${toolCall.function.name} failed with HTTP ${response.status}`, payload };
  }
  return payload;
}

function capiroToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'get_client_context',
        description: 'Load authorized Capiro client context for the selected tenant/user.',
        parameters: {
          type: 'object',
          properties: { clientId: { type: 'string' } },
          required: ['clientId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'search_research_sources',
        description: 'Search authorized Capiro clients, meetings, mail, notes, and directory notes.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            clientId: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 25 },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'create_meeting_brief',
        description: 'Create and persist a meeting brief artifact from authorized Capiro data.',
        parameters: {
          type: 'object',
          properties: { meetingId: { type: 'string' }, title: { type: 'string' } },
          required: ['meetingId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'draft_policy_memo',
        description: 'Create and persist a policy memo artifact from authorized Capiro client context.',
        parameters: {
          type: 'object',
          properties: {
            clientId: { type: 'string' },
            title: { type: 'string' },
            objective: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['clientId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'save_note',
        description: 'Save a user-scoped Clio note and optionally an encrypted meeting note.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            clientId: { type: 'string' },
            meetingId: { type: 'string' },
            confidential: { type: 'boolean' },
            accessLevel: { type: 'string' },
          },
          required: ['body'],
        },
      },
    },
  ];
}

function extractArtifacts(value: unknown): RuntimeArtifact[] {
  const record = objectValue(value);
  const candidates = [record.artifact, ...(Array.isArray(record.artifacts) ? record.artifacts : [])];
  return candidates
    .map((candidate) => objectValue(candidate))
    .filter((artifact) => artifact && artifact.persisted !== false)
    .map((artifact) => ({
      title: stringValue(artifact.title) || 'Clio artifact',
      kind: stringValue(artifact.kind) || 'document',
      contentType: stringValue(artifact.contentType) || 'text/markdown',
      bodyText: stringValue(artifact.bodyText),
      s3Key: stringValue(artifact.s3Key),
      metadata: objectValue(artifact.metadata),
    }))
    .filter((artifact) => Boolean(artifact.bodyText || artifact.s3Key));
}

function extractCapiroContext(systemText: string): CapiroContext {
  const start = systemText.indexOf('{');
  const end = systemText.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  return objectValue(safeJson(systemText.slice(start, end + 1))) as CapiroContext;
}

function normalizeMessage(value: unknown): ChatMessage | null {
  const record = objectValue(value);
  const role = record.role;
  if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') return null;
  const content = normalizeContent(record.content);
  return { role, content };
}

function normalizeContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => objectValue(part))
    .map((part) => stringValue(part.text) || '')
    .join('\n');
}

function normalizeToolCall(value: unknown): ToolCall | null {
  const record = objectValue(value);
  const fn = objectValue(record.function);
  const name = stringValue(fn.name);
  if (!name) return null;
  return {
    id: stringValue(record.id) || randomUUID(),
    type: 'function',
    function: { name, arguments: stringValue(fn.arguments) || '{}' },
  };
}

function parseToolArguments(raw: string): JsonObject {
  const parsed = safeJson(raw);
  return objectValue(parsed);
}

async function persistSessionEvent(sessionId: string, event: JsonObject) {
  try {
    const dir = join(hermesHome, 'sessions');
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, `${safeFilePart(sessionId)}.jsonl`), `${JSON.stringify(event)}\n`, 'utf8');
  } catch (error) {
    console.warn('Failed to persist Clio session event', messageOf(error));
  }
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || randomUUID();
}

async function readJson(req: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return objectValue(safeJson(text));
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage): boolean {
  if (!apiKey) return true;
  const token = header(req, 'authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  return token === apiKey;
}

function unauthorized(res: ServerResponse) {
  writeJson(res, 401, { error: { message: 'Unauthorized', type: 'authentication_error' } });
}

function header(req: IncomingMessage, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || null;
  return typeof value === 'string' ? value : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function providerError(json: JsonObject, status: number): string {
  const error = objectValue(json.error);
  return stringValue(error.message) || stringValue(json.message) || `HTTP ${status}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
