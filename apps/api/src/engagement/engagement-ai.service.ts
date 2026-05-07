import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema.js';

export interface MeetingPrepInput {
  meeting: Record<string, unknown>;
  client: Record<string, unknown> | null;
  attendees: Array<Record<string, unknown>>;
  congressionalDirectoryMatches: Array<Record<string, unknown>>;
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

export interface OutreachDraftInput {
  workflow: 'campaign' | 'follow_up' | 'prep' | 'outbound_campaign';
  client: Record<string, unknown> | null;
  meeting?: Record<string, unknown> | null;
  objective?: string | null;
  recipients: Array<Record<string, unknown>>;
  context: Record<string, unknown>;
  promptTemplate?: string | null;
  existingSubject?: string | null;
  existingBody?: string | null;
}

const PROMPT_TEMPLATE_GUIDANCE: Record<string, string> = {
  thank_you:
    'Tone: warm, gracious thank-you. Acknowledge the recipient\'s recent action or support, name the specific reason for thanks, and close with a brief offer to stay in touch. No new asks.',
  follow_up:
    'Tone: polite follow-up. Reference the prior touchpoint or meeting (use supplied notes/debriefs if present), restate one clear ask or next step, and propose a concrete next action.',
  memo:
    'Format as a concise memo / position paper. Lead with a one-line summary, then short Background, Ask, and Supporting Points sections. Keep under 300 words; use plain language.',
  introduction:
    'Tone: introductory, professional. Briefly introduce the client and why you are reaching out, the relevance to the recipient\'s portfolio, and a low-friction first ask (e.g., a 15-minute conversation).',
  meeting_request:
    'Goal: request a meeting. State the reason for meeting, suggested 2-3 scheduling windows, who would attend, and a one-sentence agenda. Keep it short.',
  status_update:
    'Tone: brief progress update. List 2-4 short bullets on activity since last contact, current status, and next planned step. No new asks unless directly tied to the update.',
};

export interface OutreachDraftResult {
  subject: string;
  body: string;
  contextNote: string;
  provider: 'openai' | 'anthropic';
  model: string;
  raw: unknown;
}

export interface MeetingDebriefDraftInput {
  meeting: Record<string, unknown>;
  client: Record<string, unknown> | null;
  attendees: Array<Record<string, unknown>>;
  prep: Record<string, unknown> | null;
  source: { method: 'upload' | 'manual' | 'voice'; text: string };
  visibleNotes: Array<Record<string, unknown>>;
  clientContext: Record<string, unknown> | null;
  congressionalDirectoryMatches: Array<Record<string, unknown>>;
  recentMeetings: Array<Record<string, unknown>>;
  recentThreads: Array<Record<string, unknown>>;
}

export interface MeetingDebriefDraftResult {
  recap: string;
  actionItems: string[];
  notes: string;
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

const outreachDraftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body', 'contextNote'],
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
    contextNote: { type: 'string' },
  },
};

const meetingDebriefJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['recap', 'actionItems', 'notes'],
  properties: {
    recap: { type: 'string' },
    actionItems: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
};

@Injectable()
export class EngagementAiService {
  private readonly logger = new Logger(EngagementAiService.name);
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
    return this.withProviderFallback('AI meeting prep', (provider) =>
      provider === 'openai' ? this.generateWithOpenAi(input) : this.generateWithAnthropic(input),
    );
  }

  async generateOutreachDraft(input: OutreachDraftInput): Promise<OutreachDraftResult> {
    return this.withProviderFallback('AI outreach drafting', (provider) =>
      provider === 'openai'
        ? this.generateOutreachWithOpenAi(input)
        : this.generateOutreachWithAnthropic(input),
    );
  }

  async generateMeetingDebrief(
    input: MeetingDebriefDraftInput,
  ): Promise<MeetingDebriefDraftResult> {
    return this.withProviderFallback('AI debrief generation', (provider) =>
      provider === 'openai'
        ? this.generateDebriefWithOpenAi(input)
        : this.generateDebriefWithAnthropic(input),
    );
  }

  private resolveProvider(): 'openai' | 'anthropic' | null {
    if (this.preferredProvider === 'openai' && this.openaiKey) return 'openai';
    if (this.preferredProvider === 'anthropic' && this.anthropicKey) return 'anthropic';
    if (this.openaiKey) return 'openai';
    if (this.anthropicKey) return 'anthropic';
    return null;
  }

  private providerOrder(): Array<'openai' | 'anthropic'> {
    const providers: Array<'openai' | 'anthropic'> = [];
    const add = (provider: 'openai' | 'anthropic') => {
      const configured = provider === 'openai' ? this.openaiKey : this.anthropicKey;
      if (configured && !providers.includes(provider)) providers.push(provider);
    };
    if (this.preferredProvider) add(this.preferredProvider);
    add('openai');
    add('anthropic');
    return providers;
  }

  private async withProviderFallback<T>(
    operation: string,
    invoke: (provider: 'openai' | 'anthropic') => Promise<T>,
  ): Promise<T> {
    const providers = this.providerOrder();
    if (!providers.length) {
      throw new ServiceUnavailableException(
        `${operation} is not configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.`,
      );
    }

    const failures: string[] = [];
    for (const provider of providers) {
      try {
        return await invoke(provider);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'provider request failed';
        failures.push(`${provider}: ${message}`);
        if (provider !== providers[providers.length - 1]) {
          this.logger.warn(`${operation} failed with ${provider}; trying fallback provider. ${message}`);
        }
      }
    }

    throw new ServiceUnavailableException(
      `${operation} failed for all configured providers. ${failures.join(' | ')}`,
    );
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

  private async generateOutreachWithOpenAi(input: OutreachDraftInput): Promise<OutreachDraftResult> {
    if (!this.openaiKey) throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.openaiModel,
        input: this.buildOutreachPrompt(input),
        text: {
          format: {
            type: 'json_schema',
            name: 'outreach_draft',
            strict: true,
            schema: outreachDraftJsonSchema,
          },
        },
      }),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `OpenAI outreach draft failed: ${readProviderError(json, response.status)}`,
      );
    }

    const parsed = parseJsonObject(extractOpenAiText(json));
    return {
      subject: typeof parsed.subject === 'string' ? parsed.subject.trim() : '',
      body: typeof parsed.body === 'string' ? parsed.body.trim() : '',
      contextNote: typeof parsed.contextNote === 'string' ? parsed.contextNote.trim() : '',
      provider: 'openai',
      model: this.openaiModel,
      raw: json,
    };
  }

  private async generateOutreachWithAnthropic(
    input: OutreachDraftInput,
  ): Promise<OutreachDraftResult> {
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
        max_tokens: 2400,
        system:
          'You draft precise lobbying outreach from supplied CRM context. Return only valid JSON that matches the requested schema.',
        messages: [
          {
            role: 'user',
            content: `${this.buildOutreachPrompt(input)}\n\nJSON schema:\n${JSON.stringify(
              outreachDraftJsonSchema,
            )}`,
          },
        ],
      }),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Anthropic outreach draft failed: ${readProviderError(json, response.status)}`,
      );
    }

    const parsed = parseJsonObject(extractAnthropicText(json));
    return {
      subject: typeof parsed.subject === 'string' ? parsed.subject.trim() : '',
      body: typeof parsed.body === 'string' ? parsed.body.trim() : '',
      contextNote: typeof parsed.contextNote === 'string' ? parsed.contextNote.trim() : '',
      provider: 'anthropic',
      model: this.anthropicModel,
      raw: json,
    };
  }

  private async generateDebriefWithOpenAi(
    input: MeetingDebriefDraftInput,
  ): Promise<MeetingDebriefDraftResult> {
    if (!this.openaiKey) throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.openaiModel,
        input: this.buildDebriefPrompt(input),
        text: {
          format: {
            type: 'json_schema',
            name: 'meeting_debrief',
            strict: true,
            schema: meetingDebriefJsonSchema,
          },
        },
      }),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `OpenAI debrief generation failed: ${readProviderError(json, response.status)}`,
      );
    }

    const parsed = parseJsonObject(extractOpenAiText(json));
    return {
      recap: typeof parsed.recap === 'string' ? parsed.recap.trim() : '',
      actionItems: toStringList(parsed.actionItems),
      notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : '',
      provider: 'openai',
      model: this.openaiModel,
      raw: json,
    };
  }

  private async generateDebriefWithAnthropic(
    input: MeetingDebriefDraftInput,
  ): Promise<MeetingDebriefDraftResult> {
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
        max_tokens: 1800,
        system:
          'You generate accurate lobbying meeting debriefs from supplied tenant CRM context. Return only valid JSON that matches the requested schema.',
        messages: [
          {
            role: 'user',
            content: `${this.buildDebriefPrompt(input)}\n\nJSON schema:\n${JSON.stringify(
              meetingDebriefJsonSchema,
            )}`,
          },
        ],
      }),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Anthropic debrief generation failed: ${readProviderError(json, response.status)}`,
      );
    }

    const parsed = parseJsonObject(extractAnthropicText(json));
    return {
      recap: typeof parsed.recap === 'string' ? parsed.recap.trim() : '',
      actionItems: toStringList(parsed.actionItems),
      notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : '',
      provider: 'anthropic',
      model: this.anthropicModel,
      raw: json,
    };
  }

  private buildPrompt(input: MeetingPrepInput): string {
    return [
      'Create meeting prep for this lobbying interaction.',
      'Use the client context, past meetings, email threads, and open tasks. Do not invent facts.',
      'If congressionalDirectoryMatches are present, use those matched member and staff profiles as attendee context, including member bio, committee assignments, and office/location details.',
      'Return JSON with agenda, talkingPoints, risks, followUps, and summary.',
      JSON.stringify(input, null, 2),
    ].join('\n\n');
  }

  private buildOutreachPrompt(input: OutreachDraftInput): string {
    const workflowGuidance = {
      campaign:
        'Draft a campaign email for many congressional recipients. Keep {district}, {committee}, {member_priority}, and {personal_note} placeholders when useful. Do not invent recipient-specific facts not present in the supplied recipient context.',
      follow_up:
        'Draft a post-meeting follow-up email. Include a brief recap, action items, and next steps from the supplied debrief/prep/context.',
      prep: 'Draft a clean prep distribution summary suitable for a colleague or client before the meeting. Include logistics, context, talking points, and participants from the approved prep.',
      outbound_campaign:
        'Draft an outbound campaign email using the supplied recent meeting attendees, prep summaries, debrief summaries, and directory office locations. Use existingSubject/existingBody and context.metadata.outboundTemplate as the selected template structure when present. If no usable template content is present, create the email from the recipient context fields instead. Apply context.metadata.outboundTone when present. Preserve useful variables such as {attendee_names}, {attendee_emails}, {prep_summary}, {debrief_summary}, {meeting_location}, {meeting_subject}, and {meeting_date_time} so the final send can personalize each recipient preview. Do not invent missing details.',
    }[input.workflow];

    const templateGuidance =
      input.promptTemplate && input.promptTemplate !== 'custom'
        ? PROMPT_TEMPLATE_GUIDANCE[input.promptTemplate]
        : null;

    return [
      workflowGuidance,
      templateGuidance ? `Prompt template: ${input.promptTemplate}. ${templateGuidance}` : null,
      'Use only the provided client, meeting, recipient, and engagement context. Do not invent facts.',
      'Return JSON with subject, body, and contextNote. The body must be directly editable by the user.',
      JSON.stringify(input, null, 2),
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n\n');
  }

  private buildDebriefPrompt(input: MeetingDebriefDraftInput): string {
    return [
      'Generate a post-meeting debrief for a lobbying CRM.',
      'Use only the supplied source text and tenant context. Do not invent commitments, attendees, dates, votes, or facts.',
      'The recap should be concise and readable. Action items should be specific next steps when the source supports them. Notes should preserve important details for internal reference.',
      'Return JSON with recap, actionItems, and notes.',
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
