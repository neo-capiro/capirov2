import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema.js';

export interface ClioChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Bedrock-Converse-shaped tool definition. The API passes these through
 * to Clio, which forwards them to Bedrock's `toolConfig.tools[]`. The
 * agent loop inside Clio handles the tool_use → callback → tool_result
 * cycle without the API having to participate.
 */
export interface ClioToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ClioChatRequest {
  messages: ClioChatMessage[];
  model?: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Capiro session id. Required when `tools` are passed — Clio echoes
   * it back to the API on every tool callback so the controller can
   * scope to the right tenant.
   */
  sessionId?: string;
  tools?: ClioToolDefinition[];
}

export interface ClioChatResponse {
  message: ClioChatMessage;
  model: string;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  // When the agent loop ran one or more tools, Clio surfaces a summary
  // here so the API can render an audit trail in the message metadata.
  toolCalls?: Array<{ name: string; status: 'ok' | 'error'; durationMs: number }>;
}

/**
 * HTTP client for the Clio Python runtime running in the same VPC as a
 * separate Fargate service. Discovers Clio via Cloud Map DNS
 * (`clio.capiro-{env}.local`) injected as `CLIO_BASE_URL` on the API task.
 *
 * The API process is the only thing that talks to Clio; the browser never
 * does. So all of: auth (Capiro session token), tenant scoping, audit
 * logging happen here, before any payload leaves the API. Errors from Clio
 * (Bedrock validation, throttling, model access) bubble up as redacted
 * exceptions — we never leak the underlying provider error.
 */
@Injectable()
export class ClioRuntimeClient {
  private readonly logger = new Logger(ClioRuntimeClient.name);
  private readonly baseUrl: string;
  private readonly defaultTimeoutMs = 60_000;

  constructor(config: ConfigService<AppConfig, true>) {
    // Empty string in local dev means Clio isn't reachable yet; calls
    // will throw a ServiceUnavailable. That's the same behavior we want
    // when the Cloud Map record hasn't propagated yet on a fresh deploy.
    this.baseUrl = config.get('CLIO_BASE_URL', { infer: true }) ?? '';
  }

  isConfigured(): boolean {
    return this.baseUrl.length > 0;
  }

  async healthz(): Promise<{ status: string; version: string; model: string }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Clio runtime not configured');
    }
    const res = await fetch(`${this.baseUrl}/healthz`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`Clio /healthz returned ${res.status}`);
    }
    return (await res.json()) as { status: string; version: string; model: string };
  }

  async chat(request: ClioChatRequest, opts?: { timeoutMs?: number }): Promise<ClioChatResponse> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Clio runtime not configured');
    }
    const body = {
      messages: request.messages,
      model: request.model,
      system: request.system,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      session_id: request.sessionId,
      tools: request.tools,
    };
    // When tools are passed the agent loop may invoke several Bedrock
    // turns + callbacks back to this API; bump the deadline so a
    // multi-step task doesn't time out at the first sign of latency.
    const timeoutMs = opts?.timeoutMs ?? (request.tools?.length ? 180_000 : this.defaultTimeoutMs);
    const res = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`clio /chat ${res.status}: ${text.slice(0, 200)}`);
      // Map upstream Clio statuses to API-side semantics. 400/403 stay as
      // ServiceUnavailable from the caller's perspective — the user didn't
      // send a bad request, the model provider is the one rejecting.
      throw new ServiceUnavailableException('Clio runtime error');
    }

    const json = (await res.json()) as {
      message: { role: 'assistant'; content: string };
      model: string;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
      tool_calls?: Array<{ name: string; status: 'ok' | 'error'; duration_ms: number }>;
    };
    return {
      message: json.message,
      model: json.model,
      stopReason: json.stop_reason,
      usage: { inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens },
      toolCalls: json.tool_calls?.map((t) => ({
        name: t.name,
        status: t.status,
        durationMs: t.duration_ms,
      })),
    };
  }
}
