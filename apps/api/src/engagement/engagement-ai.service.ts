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

const POST_MEETING_MEMO_GUIDANCE = [
  'Template name: post meeting memo.',
  'Generate an internal post-meeting memo in Markdown. This is not a normal campaign email.',
  'Use context.metadata.campaignCurrentDateTimeDisplay as the Date / Time value. If only context.metadata.campaignCurrentDateTime is present, format that timestamp. Do not use a stale or guessed date.',
  'Use only the supplied client, recipient, meeting, debrief, email thread, and congressional directory context. If a requested fact is not present, omit that bullet, participant, subsection, or section. Do not leave bracket placeholders, variable tokens, or made-up details.',
  'Use Directory member/staffer profiles for House/Senate labels, committee/subcommittee names, titles, offices, and chamber. Use client records for client participants and client details. Use email thread snippets or meeting attendees only when present. Use saved meeting debriefs for summaries, feedback, action items, and follow-ups.',
  'Organize the memo in this order when source data supports each section:',
  '## Date / Time',
  '**Use the resolved current day, date, time, and timezone from metadata.**',
  '# Meeting Participants',
  'Create a House subsection only when House participant or committee data is present; use the actual committee/subcommittee name in the heading when available.',
  '### Participants:',
  'Participant bullets should include only available name, title, committee, or office data.',
  'Create a Senate subsection only when Senate participant or committee data is present; use the actual committee/subcommittee name in the heading when available.',
  '# Summary - Key Takeaways',
  '## Purpose of Engagement',
  '## Core Problem Set',
  '## Platform / Initiative / Capability Overview',
  '## Differentiation from Other Solutions',
  '## Government Engagements to Date',
  '# Policy and Strategic Implications',
  '# House Staff Feedback',
  '# Senate Staff Feedback',
  '# Key Themes Identified',
  '### Policy Themes',
  '### Operational Themes',
  '### Strategic Themes',
  '# Risks / Concerns Raised',
  '# Opportunities Identified',
  '# Follow-Up Items and Next Steps',
  '## Action Items',
  '### Client or Organization',
  '### Congressional Staff',
  '## Materials to Provide',
  '# Strategic Assessment',
  '## Overall Sentiment',
  '## Key Opportunity Areas',
  '## Recommended Engagement Strategy',
  '# Internal Notes',
  'For optional sections, include them only when source context supports them.',
].join('\n');

const PROMPT_TEMPLATE_GUIDANCE: Record<string, string> = {
  thank_you:
    "Tone: warm, gracious thank-you. Acknowledge the recipient's recent action or support, name the specific reason for thanks, and close with a brief offer to stay in touch. No new asks.",
  follow_up:
    'Tone: polite follow-up. Reference the prior touchpoint or meeting (use supplied notes/debriefs if present), restate one clear ask or next step, and propose a concrete next action.',
  memo: 'Format as a concise memo / position paper. Lead with a one-line summary, then short Background, Ask, and Supporting Points sections. Keep under 300 words; use plain language.',
  post_meeting_memo: POST_MEETING_MEMO_GUIDANCE,
  introduction:
    "Tone: introductory, professional. Briefly introduce the client and why you are reaching out, the relevance to the recipient's portfolio, and a low-friction first ask (e.g., a 15-minute conversation).",
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
          this.logger.warn(
            `${operation} failed with ${provider}; trying fallback provider. ${message}`,
          );
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
          'You generate lobbying meeting preparation anchored in the SPECIFIC interaction history (past meetings, email threads, open tasks) and the attendees\' congressional directory profiles. Never produce a generic company overview or marketing-style description of the client — the reader already knows who the client is. If the interaction history is empty, say so explicitly rather than padding with client profile narrative. Return only valid JSON matching the requested schema.',
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

  private async generateOutreachWithOpenAi(
    input: OutreachDraftInput,
  ): Promise<OutreachDraftResult> {
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
      'You are preparing a lobbyist for an upcoming meeting. The audience already knows who the client is — do NOT write a company overview, a marketing-style description of the client, or a generic "what the client does" summary. The output must be grounded in the SPECIFIC interactions, threads, tasks, and attendee profiles supplied below.',
      'Hard rules:',
      '- Every agenda item, talking point, risk, and follow-up must be traceable to a concrete signal in `recentMeetings`, `recentThreads`, `tasks`, `congressionalDirectoryMatches`, or the current `meeting` object. If you cannot tie an item to one of those, omit it.',
      '- The `summary` is a 2-3 sentence situational brief about THIS meeting in the context of the relationship history. It is NOT a description of the client company. Mention the latest substantive exchange (most recent meeting outcome, most recent email thread topic, or the open task driving the meeting).',
      '- `talkingPoints` should reference what was last discussed/asked/promised and what should be raised next, not generic capabilities of the client.',
      '- `followUps` and `risks` come from open tasks, unresolved threads, prior meeting commitments, or directory-known concerns (e.g., the member sits on a relevant subcommittee with a known position).',
      '- For each attendee in `attendees`, look for a matching entry in `congressionalDirectoryMatches` and weave in their chamber, committee/subcommittee assignments, title, district, and office context. These are the people in the room — they should drive the prep.',
      '- Do not restate `client.description`, `client.productDescription`, or `client.intakeData` as narrative. You may reference a product name only when it ties to a specific past interaction (e.g., "Last meeting on May 2 discussed Program X").',
      '- If recentMeetings, recentThreads, and tasks are all empty, say so plainly in `summary` ("No prior interactions on record — this appears to be a first touch.") and keep the rest of the output sparse rather than fabricating substance from the client profile.',
      '- Do not invent facts, dates, attendees, votes, commitments, or directory entries that are not in the input.',
      'Return JSON: { agenda: string[], talkingPoints: string[], risks: string[], followUps: string[], summary: string }.',
      'INPUT:',
      JSON.stringify(input, null, 2),
    ].join('\n\n');
  }

  private buildOutreachPrompt(input: OutreachDraftInput): string {
    const workflowGuidance = {
      campaign:
        'Draft a campaign for congressional recipients. Do not output literal variable tokens such as {district}, {committee}, {personal_note}, {address}, or {member_priority}. Use supplied recipient data only when it is present; otherwise write around the missing detail. Do not invent recipient-specific facts.',
      follow_up:
        'Draft a post-meeting follow-up email. Include a brief recap, action items, and next steps from the supplied debrief/prep/context.',
      prep: 'Draft a clean prep distribution summary suitable for a colleague or client before the meeting. Include logistics, context, talking points, and participants from the approved prep.',
      outbound_campaign:
        'Draft an outbound campaign email using the supplied recent meeting attendees, prep summaries, debrief summaries, and directory office locations. Use existingSubject/existingBody and context.metadata.outboundTemplate as the selected template structure when present. Keep the letterhead near the top with Date, Participant Names, and Location. Use context.metadata.outboundCurrentDateTime as the current generated date/time. If no usable template content is present, create the email from the recipient context fields instead. Apply context.metadata.outboundTone when present. Preserve useful variables such as {current_date_time}, {attendee_names}, {attendee_emails}, {prep_summary}, {debrief_summary}, {meeting_location}, {meeting_subject}, and {meeting_date_time} so the final send can personalize each recipient preview. Do not invent missing details.',
    }[input.workflow];

    const templateGuidance =
      input.promptTemplate && input.promptTemplate !== 'custom'
        ? PROMPT_TEMPLATE_GUIDANCE[input.promptTemplate]
        : null;

    return [
      workflowGuidance,
      templateGuidance ? `Prompt template: ${input.promptTemplate}. ${templateGuidance}` : null,
      'Use only the provided client, meeting, recipient, and engagement context. Do not invent facts.',
      'Never return unresolved template variables or bracket placeholders in subject or body. Use real provided values or omit the unsupported line/phrase.',
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
