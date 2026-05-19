import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema.js';
import { LobbyIntelService } from '../lobby-intel/lobby-intel.service.js';

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
  emailEvidence: string[];
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

export interface CampaignEmailInput {
  campaign: Record<string, unknown>;
  client: Record<string, unknown> | null;
  meeting: Record<string, unknown> | null;
  debrief: Record<string, unknown> | null;
  prep: Record<string, unknown> | null;
  recipients: Array<Record<string, unknown>>;
  campaignType: string;
  customContext?: string | null;
}

export interface CampaignEmailResult {
  subject: string;
  body: string;
  provider: 'openai' | 'anthropic';
  model: string;
  raw: unknown;
}

const meetingPrepJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['agenda', 'talkingPoints', 'risks', 'followUps', 'summary', 'emailEvidence'],
  properties: {
    agenda: { type: 'array', items: { type: 'string' } },
    talkingPoints: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    followUps: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    emailEvidence: { type: 'array', items: { type: 'string' } },
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

const campaignEmailJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body'],
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
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

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly lobbyIntel: LobbyIntelService,
  ) {
    this.openaiKey = config.get('OPENAI_API_KEY', { infer: true });
    this.anthropicKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.preferredProvider = config.get('AI_PROVIDER', { infer: true });
    this.openaiModel = config.get('OPENAI_MODEL', { infer: true });
    this.anthropicModel = config.get('ANTHROPIC_MODEL', { infer: true });
  }

  /**
   * Compact federal-lobbying-intelligence context block for AI prompts.
   * Returns "" when sync hasn't run yet (zero rows) so prompts degrade
   * gracefully.
   */
  private async buildFederalContextBlock(): Promise<string> {
    try {
      const ctx = await this.lobbyIntel.getAiContext();
      const surge = ctx.surgingIssues
        .slice(0, 6)
        .map(
          (s) =>
            `${s.code} (${s.name})${
              s.surgePct != null ? `: +${Math.round(s.surgePct)}% QoQ` : ''
            }`,
        )
        .join('; ');
      const trending = ctx.trendingTopics
        .slice(0, 8)
        .map((t) => t.word)
        .filter(Boolean)
        .join(', ');
      if (!surge && !trending) return '';
      const parts: string[] = ['Current federal lobbying context (Senate LDA, OpenLobby):'];
      if (ctx.latestQuarter) parts.push(`Latest quarter: ${ctx.latestQuarter}.`);
      if (surge) parts.push(`Surging LDA issues: ${surge}.`);
      if (trending) parts.push(`Trending terms in filings: ${trending}.`);
      parts.push(
        'Use these only when relevant to the client/recipient; do not force-fit unrelated topics or invent facts.',
      );
      return parts.join(' ');
    } catch (err) {
      this.logger.warn(`Federal context fetch failed (degrading): ${(err as Error).message}`);
      return '';
    }
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
    const federalContext = await this.buildFederalContextBlock();
    const enriched: MeetingPrepInput = federalContext
      ? {
          ...input,
          meeting: { ...input.meeting, federalLobbyIntel: federalContext },
        }
      : input;
    return this.withProviderFallback('AI meeting prep', (provider) =>
      provider === 'openai'
        ? this.generateWithOpenAi(enriched)
        : this.generateWithAnthropic(enriched),
    );
  }

  async generateOutreachDraft(input: OutreachDraftInput): Promise<OutreachDraftResult> {
    const federalContext = await this.buildFederalContextBlock();
    const enriched = federalContext
      ? { ...input, context: { ...input.context, federalLobbyIntel: federalContext } }
      : input;
    return this.withProviderFallback('AI outreach drafting', (provider) =>
      provider === 'openai'
        ? this.generateOutreachWithOpenAi(enriched)
        : this.generateOutreachWithAnthropic(enriched),
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

  async generateCampaignEmail(input: CampaignEmailInput): Promise<CampaignEmailResult> {
    const federalContext = await this.buildFederalContextBlock();
    const enriched = federalContext
      ? {
          ...input,
          customContext: input.customContext
            ? `${input.customContext}\n\n${federalContext}`
            : federalContext,
        }
      : input;
    return this.withProviderFallback('AI campaign email generation', (provider) =>
      provider === 'openai'
        ? this.generateCampaignWithOpenAi(enriched)
        : this.generateCampaignWithAnthropic(enriched),
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
      emailEvidence: toStringList(parsed.emailEvidence),
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
      emailEvidence: toStringList(parsed.emailEvidence),
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

  private async generateCampaignWithOpenAi(input: CampaignEmailInput): Promise<CampaignEmailResult> {
    if (!this.openaiKey) throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.openaiModel,
        input: this.buildCampaignPrompt(input),
        text: {
          format: {
            type: 'json_schema',
            name: 'campaign_email',
            strict: true,
            schema: campaignEmailJsonSchema,
          },
        },
      }),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `OpenAI campaign email failed: ${readProviderError(json, response.status)}`,
      );
    }

    const parsed = parseJsonObject(extractOpenAiText(json));
    return {
      subject: typeof parsed.subject === 'string' ? parsed.subject.trim() : '',
      body: typeof parsed.body === 'string' ? parsed.body.trim() : '',
      provider: 'openai',
      model: this.openaiModel,
      raw: json,
    };
  }

  private async generateCampaignWithAnthropic(input: CampaignEmailInput): Promise<CampaignEmailResult> {
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
          'You draft professional government affairs follow-up emails from lobbying CRM context. Return only valid JSON that matches the requested schema.',
        messages: [
          {
            role: 'user',
            content: `${this.buildCampaignPrompt(input)}\n\nJSON schema:\n${JSON.stringify(
              campaignEmailJsonSchema,
            )}`,
          },
        ],
      }),
    });

    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Anthropic campaign email failed: ${readProviderError(json, response.status)}`,
      );
    }

    const parsed = parseJsonObject(extractAnthropicText(json));
    return {
      subject: typeof parsed.subject === 'string' ? parsed.subject.trim() : '',
      body: typeof parsed.body === 'string' ? parsed.body.trim() : '',
      provider: 'anthropic',
      model: this.anthropicModel,
      raw: json,
    };
  }

  private buildPrompt(input: MeetingPrepInput): string {
    const emailHighlights = formatMeetingPrepEmailHighlights(input.recentThreads);
    const hasEmailThreads = input.recentThreads.length > 0;
    const hasPriorMeetings = input.recentMeetings.length > 0;
    const hasDirectoryMatches = input.congressionalDirectoryMatches.length > 0;
    const hasTasks = input.tasks.length > 0;

    return [
      'Create a comprehensive meeting prep for this lobbying interaction.',
      'Structure the output as follows across the summary and arrays:',
      '1. MEETING OBJECTIVE — derive from meeting subject, client context, and attendee profiles. State what success looks like for this meeting.',
      '2. EXECUTIVE SUMMARY — 2-3 sentences: who is meeting, why, and what the expected outcome is.',
      '3. KEY DISCUSSION POINTS — the 3-5 most important substantive topics to address, drawn from client program, prior meetings, and email threads.',
      '4. ATTENDEE PROFILES — for each congressional attendee, include their committee/subcommittee role, jurisdiction relevance, and any known positions or prior engagement history.',
      '5. TALKING POINTS — specific, evidence-backed points the lobbyist should make. Reference client capabilities, funding requests, or program details when available.',
      '6. RISK FACTORS — potential objections, competing priorities, or sensitivities to be aware of (based on committee dynamics, prior meeting outcomes, or email evidence).',
      '7. ACTION ITEMS — concrete follow-up commitments likely to arise, based on prior meeting history and open tasks.',
      '8. LOGISTICS — location, timing, attendee list confirmation.',
      '',
      'Use the client context, past meetings, email threads, and open tasks. Do not invent facts.',
      hasDirectoryMatches
        ? 'congressionalDirectoryMatches are present — use those matched member and staff profiles for attendee context: member bio, committee assignments, subcommittee roles, office/location details, and known policy positions.'
        : 'No congressional directory matches were provided.',
      hasPriorMeetings
        ? 'recentMeetings are present — reference prior meeting debriefs to identify pending action items, ongoing relationships, and unresolved discussion points. Note any commitments made in previous meetings that should be followed up on.'
        : 'No prior meetings with these attendees were found.',
      hasTasks
        ? 'tasks are present — incorporate open tasks as action items context. Flag any overdue or high-priority tasks that relate to this meeting.'
        : 'No open tasks were found.',
      hasEmailThreads
        ? 'Use recentThreads as primary evidence for talkingPoints, risks, and followUps. Include concrete details such as sender, date, and short quoted phrases from email content when available.'
        : 'No recentThreads were provided. Keep output grounded in available non-email context only.',
      hasEmailThreads
        ? 'Populate emailEvidence with 2-6 concise evidence bullets grounded in recentThreads. If an item in talkingPoints or risks is supported by email context, reflect that support in emailEvidence.'
        : 'Set emailEvidence to an empty array when no usable email evidence exists.',
      'Return JSON with agenda (structured as the 8 sections above, each as a string), talkingPoints, risks, followUps, summary (meeting objective + executive summary as a single narrative), and emailEvidence.',
      'Email thread highlights (for grounding):',
      emailHighlights,
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
      'Generate a comprehensive post-meeting debrief for a lobbying CRM.',
      'Use only the supplied source text and tenant context. Do not invent commitments, attendees, dates, votes, or facts.',
      '',
      'Structure the output as follows:',
      '',
      'recap: A structured narrative covering:',
      '  - RECAP: Who attended, what was discussed, key decisions made, and commitments given by each party. Quote or closely paraphrase specific statements when the source supports it.',
      '  - FOLLOW-UP REQUIRED: Specific next steps with suggested timeline (e.g., "Send white paper by Friday", "Schedule follow-up call within 2 weeks").',
      '  - INTELLIGENCE GATHERED: Any new information about member positions, committee dynamics, upcoming hearings, budget priorities, or political landscape that emerged in the meeting.',
      '  - CAMPAIGN SUGGESTION: Based on the meeting outcome, suggest a follow-up outreach campaign (e.g., "Post-meeting thank-you + position paper to [staffer name]" or "Schedule follow-up with [committee] after [hearing]").',
      '',
      'actionItems: An array of specific, ownable next steps. Each item should be formatted as: "[Owner] — [Action] by [Timeline if known]". Extract these from commitments made, follow-ups requested, or materials promised.',
      '',
      'notes: Internal notes preserving context not captured in the recap — tone of the meeting, body language observations, off-the-record comments, strategic observations about the member/staffer relationship, and anything the lobbyist should remember for the next engagement.',
      '',
      'Return JSON with recap, actionItems, and notes.',
      JSON.stringify(input, null, 2),
    ].join('\n');
  }

  private buildCampaignPrompt(input: CampaignEmailInput): string {
    const typeGuidance: Record<string, string> = {
      post_meeting_followup:
        'This is a post-meeting follow-up email. Reference the specific meeting that occurred, key discussion points, commitments made, and next steps. The tone should be warm, professional, and action-oriented. Reference the attendees by name and role where available.',
      congressional_outreach:
        'This is a congressional outreach email. It should be policy-focused, referencing the client\'s program, capabilities, or legislative ask. Tailor to the recipient\'s committee jurisdiction and known priorities.',
      program_update:
        'This is a program update email to keep congressional contacts informed of client progress. Highlight recent milestones, upcoming activities, and any asks for continued support.',
      custom:
        'Draft a professional government affairs email using the supplied context. Match the tone and substance to the campaign objective.',
    };

    const guidance = typeGuidance[input.campaignType] ?? typeGuidance.custom;

    return [
      `Campaign type: ${input.campaignType}. ${guidance}`,
      'Use only the provided client, meeting, debrief, prep, and recipient context. Do not invent facts, commitments, or positions.',
      'The email should read as if written by a senior government affairs professional — not generic.',
      'Reference specific discussion points, action items, and next steps from the supplied meeting/debrief context when available.',
      'Use template variables {recipient_name}, {recipient_title}, {meeting_date}, {action_items} where appropriate for per-recipient personalization at send time.',
      'Do not leave unresolved bracket placeholders or variables that have no corresponding context.',
      'Return JSON with subject and body.',
      input.customContext ? `Additional campaign context from user: ${input.customContext}` : '',
      JSON.stringify(input, null, 2),
    ]
      .filter(Boolean)
      .join('\n\n');
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

function formatMeetingPrepEmailHighlights(threads: Array<Record<string, unknown>>): string {
  if (!threads.length) return '- None';

  const lines: string[] = [];
  for (const thread of threads.slice(0, 8)) {
    const threadRecord = toRecord(thread);
    const threadId = typeof threadRecord.id === 'string' ? threadRecord.id : 'unknown-thread';
    const threadSubject = typeof threadRecord.subject === 'string' ? threadRecord.subject.trim() : '';
    const messages = Array.isArray(threadRecord.messages) ? threadRecord.messages : [];
    const lastMessageAt = typeof threadRecord.lastMessageAt === 'string' ? threadRecord.lastMessageAt : '';
    const headline = `- Thread ${threadId}${threadSubject ? `: ${threadSubject}` : ''}${lastMessageAt ? ` (${lastMessageAt})` : ''}`;
    lines.push(headline);

    if (!messages.length) {
      const snippet = typeof threadRecord.snippet === 'string' ? compactText(threadRecord.snippet) : '';
      if (snippet) lines.push(`  - Snippet: "${snippet}"`);
      continue;
    }

    for (const message of messages.slice(0, 3)) {
      const messageRecord = toRecord(message);
      const sender =
        typeof messageRecord.fromName === 'string' && messageRecord.fromName.trim()
          ? messageRecord.fromName.trim()
          : typeof messageRecord.fromEmail === 'string' && messageRecord.fromEmail.trim()
            ? messageRecord.fromEmail.trim()
            : 'unknown sender';
      const sentAt = typeof messageRecord.sentAt === 'string' ? messageRecord.sentAt : '';
      const quote =
        typeof messageRecord.bodyText === 'string'
          ? compactText(messageRecord.bodyText)
          : typeof messageRecord.subject === 'string'
            ? compactText(messageRecord.subject)
            : '';
      lines.push(
        `  - ${sender}${sentAt ? ` @ ${sentAt}` : ''}${quote ? `: "${quote}"` : ''}`,
      );
    }
  }

  return lines.join('\n');
}

function compactText(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}...`;
}
