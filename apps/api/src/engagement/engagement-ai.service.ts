import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema.js';

export interface MeetingPrepInput {
  meeting: Record<string, unknown>;
  client: Record<string, unknown> | null;
  attendees: Array<Record<string, unknown>>;
  recentMeetings: Array<Record<string, unknown>>;
  recentThreads: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
}

export interface MeetingPrepResult {
  agenda: string[];
  talkingPoints: string[];
  risks: string[];
  followUps: string[];
  summary: string;
  provider: 'openai' | 'anthropic';
  model: string;
  raw: unknown;
}

const meetingPrepJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['agenda', 'talkingPoints', 'risks', 'followUps', 'summary'],
  properties: {
    agenda: { type: 'array', items: { type: 'string' } },
    talkingPoints: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    followUps: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

@Injectable()
export class EngagementAiService {
  private readonly openaiKey?: string;
  private readonly anthropicKey?: string;
  private readonly preferredProvider?: 'openai' | 'anthropic';
  private readonly openaiModel: string;
  private readonly anthropicModel: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.openaiKey = config.get('OPENAI_API_KEY', { infer: true });
    this.anthropicKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.preferredProvider = config.get('AI_PROVIDER', { infer: true });
    this.openaiModel = config.get('OPENAI_MODEL', { infer: true });
    this.anthropicModel = config.get('ANTHROPIC_MODEL', { infer: true });
  }

  capabilities() {
    return {
      openaiConfigured: Boolean(this.openaiKey),
      anthropicConfigured: Boolean(this.anthropicKey),
      activeProvider: this.resolveProvider(),
      openaiModel: this.openaiModel,
      anthropicModel: this.anthropicModel,
    };
  }

  async generateMeetingPrep(input: MeetingPrepInput): Promise<MeetingPrepResult> {
    const provider = this.resolveProvider();
    if (!provider) {
      throw new ServiceUnavailableException(
        'AI meeting prep is not configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.',
      );
    }

    if (provider === 'openai') return this.generateWithOpenAi(input);
    return this.generateWithAnthropic(input);
  }

  private resolveProvider(): 'openai' | 'anthropic' | null {
    if (this.preferredProvider === 'openai' && this.openaiKey) return 'openai';
    if (this.preferredProvider === 'anthropic' && this.anthropicKey) return 'anthropic';
    if (this.openaiKey) return 'openai';
    if (this.anthropicKey) return 'anthropic';
    return null;
  }

  private async generateWithOpenAi(input: MeetingPrepInput): Promise<MeetingPrepResult> {
    if (!this.openaiKey) throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.openaiModel,
        input: this.buildPrompt(input),
        text: {
          format: {
            type: 'json_schema',
            name: 'meeting_prep',
            strict: true,
            schema: meetingPrepJsonSchema,
          },
        },
      }),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `OpenAI meeting prep failed: ${readProviderError(json, response.status)}`,
      );
    }

    const parsed = parseJsonObject(extractOpenAiText(json));
    return {
      agenda: toStringList(parsed.agenda),
      talkingPoints: toStringList(parsed.talkingPoints),
      risks: toStringList(parsed.risks),
      followUps: toStringList(parsed.followUps),
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      provider: 'openai',
      model: this.openaiModel,
      raw: json,
    };
  }

  private async generateWithAnthropic(input: MeetingPrepInput): Promise<MeetingPrepResult> {
    if (!this.anthropicKey) {
      throw new ServiceUnavailableException('ANTHROPIC_API_KEY is not configured');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.anthropicModel,
        max_tokens: 1600,
        system:
          'You generate concise lobbying meeting preparation. Return only valid JSON that matches the requested schema.',
        messages: [
          {
            role: 'user',
            content: `${this.buildPrompt(input)}\n\nJSON schema:\n${JSON.stringify(
              meetingPrepJsonSchema,
            )}`,
          },
        ],
      }),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Anthropic meeting prep failed: ${readProviderError(json, response.status)}`,
      );
    }

    const parsed = parseJsonObject(extractAnthropicText(json));
    return {
      agenda: toStringList(parsed.agenda),
      talkingPoints: toStringList(parsed.talkingPoints),
      risks: toStringList(parsed.risks),
      followUps: toStringList(parsed.followUps),
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      provider: 'anthropic',
      model: this.anthropicModel,
      raw: json,
    };
  }

  private buildPrompt(input: MeetingPrepInput): string {
    return [
      'Create meeting prep for this lobbying interaction.',
      'Use the client context, past meetings, email threads, and open tasks. Do not invent facts.',
      'Return JSON with agenda, talkingPoints, risks, followUps, and summary.',
      JSON.stringify(input, null, 2),
    ].join('\n\n');
  }
}

function extractOpenAiText(json: Record<string, unknown>): string {
  if (typeof json.output_text === 'string') return json.output_text;
  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    const content = toRecord(item).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = toRecord(part).text;
      if (typeof text === 'string') return text;
    }
  }
  return '';
}

function extractAnthropicText(json: Record<string, unknown>): string {
  const content = Array.isArray(json.content) ? json.content : [];
  return content
    .map((part) => {
      const record = toRecord(part);
      return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
    })
    .join('\n')
    .trim();
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) throw new ServiceUnavailableException('AI provider returned an empty response');
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new ServiceUnavailableException('AI provider returned non-JSON output');
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function readProviderError(json: Record<string, unknown>, status: number): string {
  const error = toRecord(json.error);
  if (typeof error.message === 'string') return error.message;
  if (typeof json.message === 'string') return json.message;
  return `HTTP ${status}`;
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
    .filter(Boolean);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
