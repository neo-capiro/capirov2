import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema.js';
import { LobbyIntelService } from '../lobby-intel/lobby-intel.service.js';
import { FederalSpendingService } from '../federal-spending/federal-spending.service.js';

const AI_TIMEOUT_MS = 90_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ServiceUnavailableException(`AI provider request timed out after ${AI_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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

export const POST_MEETING_MEMO_GUIDANCE_TEXT = [
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

const POST_MEETING_MEMO_GUIDANCE = POST_MEETING_MEMO_GUIDANCE_TEXT;

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

export interface BatchOutreachInput {
  templatePrompt: string;
  templateName: string;
  client: Record<string, unknown> | null;
  recipient: Record<string, unknown>;
  insights: string[];
  additionalContext?: string | null;
  tone?: string | null;
  meetingHistory?: Array<Record<string, unknown>>;
  emailHistory?: Array<Record<string, unknown>>;
}

export interface TalkingPointsInput {
  client: Record<string, unknown> | null;
  selectedInsights: string[];
  additionalContext?: string | null;
}

export interface TalkingPointsResult {
  points: string[];
  provider: 'openai' | 'anthropic';
  model: string;
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
    private readonly federalSpending: FederalSpendingService,
  ) {
    this.openaiKey = config.get('OPENAI_API_KEY', { infer: true });
    this.anthropicKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.preferredProvider = config.get('AI_PROVIDER', { infer: true });
    this.openaiModel = config.get('OPENAI_MODEL', { infer: true });
    this.anthropicModel = config.get('ANTHROPIC_MODEL', { infer: true });
  }

  /**
   * Try to extract a client name from various AI input shapes for federal
   * contractor lookup. Returns null when no name is present.
   */
  private extractClientName(input: {
    client?: Record<string, unknown> | null;
  }): string | null {
    const c = input.client;
    if (!c || typeof c !== 'object') return null;
    const name = (c as { name?: unknown }).name;
    return typeof name === 'string' && name.trim() ? name : null;
  }

  /**
   * Compact federal context block for AI prompts. Combines:
   *   - LobbyIntel surging issues + trending terms (always)
   *   - FederalSpending: matched contractor's contracts + top federal agencies
   *     they win business from (when the client name matches)
   * Returns "" when no useful data is available.
   */
  private async buildFederalContextBlock(clientName: string | null): Promise<string> {
    const parts: string[] = [];
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
      if (surge || trending) {
        parts.push('Current federal lobbying context (Senate LDA, OpenLobby):');
        if (ctx.latestQuarter) parts.push(`Latest quarter: ${ctx.latestQuarter}.`);
        if (surge) parts.push(`Surging LDA issues: ${surge}.`);
        if (trending) parts.push(`Trending terms in filings: ${trending}.`);
      }
    } catch (err) {
      this.logger.warn(`Lobby context fetch failed (degrading): ${(err as Error).message}`);
    }

    try {
      const spend = await this.federalSpending.getAiContext(clientName);
      if (spend.matchedContractor) {
        const mc = spend.matchedContractor;
        const agencyList = mc.topAgencies
          .slice(0, 4)
          .map(
            (a) =>
              `${a.name} ($${Math.round(a.amount / 1e9).toLocaleString()}B)`,
          )
          .join('; ');
        const contractAmt =
          mc.totalContracts != null
            ? `$${(mc.totalContracts / 1e9).toFixed(1)}B in FY2025 federal contracts`
            : 'federal contracts (amount unknown)';
        parts.push(
          `Federal contracting context for this client: ${mc.name} won ${contractAmt}` +
            (mc.rankByContracts ? ` (rank #${mc.rankByContracts} nationally)` : '') +
            (mc.category ? `, primary category: ${mc.category}` : '') +
            (agencyList ? `. Top awarding agencies: ${agencyList}.` : '.'),
        );
      }
      if (spend.topAgencyTotals.length) {
        const topAg = spend.topAgencyTotals
          .slice(0, 4)
          .map(
            (a) =>
              `${a.name}${a.budget ? ` ($${(a.budget / 1e12).toFixed(1)}T)` : ''}`,
          )
          .join(', ');
        if (topAg) parts.push(`Top federal agencies by budget: ${topAg}.`);
      }
    } catch (err) {
      this.logger.warn(`Federal spend context fetch failed (degrading): ${(err as Error).message}`);
    }

    if (!parts.length) return '';
    parts.push(
      'Use these only when relevant to the client/recipient; do not force-fit unrelated topics or invent facts.',
    );
    return parts.join(' ');
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
    const federalContext = await this.buildFederalContextBlock(this.extractClientName(input));
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
    const federalContext = await this.buildFederalContextBlock(this.extractClientName(input));
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

  async generateBatchEmail(input: BatchOutreachInput): Promise<OutreachDraftResult> {
    const federalContext = await this.buildFederalContextBlock(this.extractClientName(input));
    const insightBlock = input.insights.length
      ? `Selected intelligence insights:\n${input.insights.map((s) => `- ${s}`).join('\n')}`
      : null;
    const enrichedContext: Record<string, unknown> = {
      ...(insightBlock ? { intelligenceInsights: insightBlock } : {}),
      ...(input.additionalContext ? { additionalContext: input.additionalContext } : {}),
      ...(federalContext ? { federalLobbyIntel: federalContext } : {}),
      ...(input.meetingHistory?.length ? { meetingHistory: input.meetingHistory } : {}),
      ...(input.emailHistory?.length ? { emailHistory: input.emailHistory } : {}),
    };
    const draftInput: OutreachDraftInput = {
      workflow: 'campaign',
      client: input.client,
      recipients: [input.recipient],
      promptTemplate: input.templateName,
      context: enrichedContext,
      objective: input.templatePrompt,
      ...(input.tone ? { existingBody: `Tone preference: ${input.tone}` } : {}),
    };
    return this.withProviderFallback('AI batch email generation', (provider) =>
      provider === 'openai'
        ? this.generateOutreachWithOpenAi(draftInput)
        : this.generateOutreachWithAnthropic(draftInput),
    );
  }

  async generateTalkingPoints(input: TalkingPointsInput): Promise<TalkingPointsResult> {
    const prompt = [
      'Generate 3-5 sharp, specific talking points for a federal lobbying outreach campaign.',
      'Each talking point should be a single, persuasive sentence that a lobbyist could use in a congressional meeting or email.',
      'Base the talking points on the provided intelligence insights and client context.',
      'Do not invent facts. Use only the supplied context.',
      'Return JSON with a "points" array of strings.',
      input.client ? `Client context: ${JSON.stringify(input.client)}` : null,
      input.selectedInsights.length
        ? `Selected insights:\n${input.selectedInsights.map((s) => `- ${s}`).join('\n')}`
        : null,
      input.additionalContext ? `Additional context: ${input.additionalContext}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n\n');

    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['points'],
      properties: { points: { type: 'array', items: { type: 'string' } } },
    };

    return this.withProviderFallback('AI talking points', async (provider) => {
      let raw: Record<string, unknown>;
      if (provider === 'openai') {
        if (!this.openaiKey) throw new ServiceUnavailableException('OPENAI_API_KEY not configured');
        const res = await fetchWithTimeout('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.openaiModel,
            input: prompt,
            text: { format: { type: 'json_schema', name: 'talking_points', strict: true, schema } },
          }),
        });
        raw = (await res.json()) as Record<string, unknown>;
        if (!res.ok)
          throw new ServiceUnavailableException(
            `OpenAI talking points failed: ${readProviderError(raw, res.status)}`,
          );
        const parsed = parseJsonObject(extractOpenAiText(raw));
        return { points: toStringList(parsed.points), provider: 'openai', model: this.openaiModel };
      } else {
        if (!this.anthropicKey)
          throw new ServiceUnavailableException('ANTHROPIC_API_KEY not configured');
        const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': this.anthropicKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.anthropicModel,
            max_tokens: 800,
            system:
              'You are a federal lobbying expert. Generate precise talking points from the supplied context. Return only valid JSON.',
            messages: [
              { role: 'user', content: `${prompt}\n\nJSON schema:\n${JSON.stringify(schema)}` },
            ],
          }),
        });
        raw = (await res.json()) as Record<string, unknown>;
        if (!res.ok)
          throw new ServiceUnavailableException(
            `Anthropic talking points failed: ${readProviderError(raw, res.status)}`,
          );
        const parsed = parseJsonObject(extractAnthropicText(raw));
        return {
          points: toStringList(parsed.points),
          provider: 'anthropic',
          model: this.anthropicModel,
        };
      }
    });
  }

  async generateCampaignEmail(input: CampaignEmailInput): Promise<CampaignEmailResult> {
    const federalContext = await this.buildFederalContextBlock(this.extractClientName(input));
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

    const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
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

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
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

    const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
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

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
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

    const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
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

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
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

    const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
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

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
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
      'Write a lobbyist-ready meeting prep. Keep it concise, specific, and decision-focused.',
      'Use only provided data. If a fact is missing, omit it. Do not guess, infer people\'s positions, or invent commitments.',
      '',
      'Output structure (JSON fields):',
      'agenda: short section headers with one-line guidance for: Objective, Executive Summary, Discussion Priorities, Attendee Context, Risks, Logistics.',
      'talkingPoints: 3-7 concrete points the lobbyist can say in the room.',
      'risks: 2-5 likely objections/sensitivities grounded in supplied context only.',
      'followUps: specific next steps with owner/timing when known; if unknown, leave timing blank rather than fabricating.',
      'summary: 2-4 sentence plain-language brief (who, why now, what success looks like).',
      'emailEvidence: concise bullets from provided threads only; empty array when none.',
      '',
      hasDirectoryMatches
        ? 'Use congressionalDirectoryMatches for attendee context (role, committee/jurisdiction, office details) when present.'
        : 'No congressional directory matches were provided.',
      hasPriorMeetings
        ? 'Use recentMeetings to carry forward unresolved items and prior commitments that are explicitly documented.'
        : 'No prior meetings with these attendees were found.',
      hasTasks
        ? 'Use tasks to surface open/overdue work relevant to this meeting.'
        : 'No open tasks were found.',
      hasEmailThreads
        ? 'Use recentThreads as evidence for talkingPoints/risks/followUps; quote or paraphrase only what is present.'
        : 'No recentThreads were provided. Keep output grounded in available non-email context only.',
      'Tone: professional federal lobbying operator, direct, practical, no fluff.',
      'Return JSON only with: agenda, talkingPoints, risks, followUps, summary, emailEvidence.',
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

    // The v2 outreach wizard sends a curated `contextItems` block as part
    // of `input.context`. Each item carries the user's intent: shared items
    // form the spine of the message, personalized items must be reflected
    // for that specific recipient, and per-item `Instruction:` lines are
    // direct user directives (e.g. "lead with this", "omit the deadline
    // language"). We hoist the block out of the raw JSON dump so the model
    // sees it as a first-class section with explicit guidance, and we
    // remove it from the JSON to avoid duplication that dilutes attention.
    const direction =
      typeof input.context?.direction === 'string' ? input.context.direction : null;
    const contextItemsBlock =
      typeof input.context?.contextItems === 'string' &&
      (input.context.contextItems as string).trim().length > 0
        ? (input.context.contextItems as string).trim()
        : null;
    const contextWithoutItems = contextItemsBlock
      ? Object.fromEntries(
          Object.entries(input.context ?? {}).filter(
            ([k]) => k !== 'contextItems' && k !== 'direction',
          ),
        )
      : (input.context ?? {});
    const inputForJson: OutreachDraftInput = contextItemsBlock
      ? { ...input, context: contextWithoutItems }
      : input;

    const directionGuidance = direction
      ? direction === 'on-behalf'
        ? "Direction: on-behalf-of-client. The sender is the lobbyist's user, writing as the representative of `client`. The recipient is a congressional or federal-agency contact. Use the client's voice and the client's asks; reference the client by name where natural. Sign as the user, not the client."
        : 'Direction: from-lobbyist-to-clients. The sender is the lobbyist writing directly to their own portfolio client(s). The tone is internal briefing, informative, candid, action-oriented. Do not write as if pitching the client; you ARE the client\'s trusted operator.'
      : null;

    const contextItemsGuidance = contextItemsBlock
      ? [
          'CURATED CONTEXT, treat this as the source-of-truth for what to include and how. The list below is grouped into:',
          '  • "Shared context", must inform every recipient\'s draft. These are the campaign\'s spine.',
          '  • "Personalized context for this recipient", must be reflected explicitly in this draft only. If a per-item `Instruction:` line is present, follow it (e.g. "lead with this", "omit the deadline language", "soften the ask").',
          'When a personalized item conflicts with a shared item, the personalized item wins for that recipient. If an item is a `[note]` kind, treat its body and Instruction as a direct user directive to obey, not as fact to cite.',
          'Do not cite items the user did not curate, do not pull from the raw JSON dump if those facts are not in the curated block. Do not enumerate the items back to the recipient; weave them into a coherent message.',
          '',
          contextItemsBlock,
        ].join('\n')
      : null;

    return [
      workflowGuidance,
      directionGuidance,
      templateGuidance ? `Prompt template: ${input.promptTemplate}. ${templateGuidance}` : null,
      'Use only the provided client, meeting, recipient, and engagement context. Do not invent facts.',
      'Never return unresolved template variables or bracket placeholders in subject or body. Use real provided values or omit the unsupported line/phrase.',
      contextItemsGuidance,
      'Return JSON with subject, body, and contextNote. The body must be directly editable by the user.',
      JSON.stringify(inputForJson, null, 2),
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n\n');
  }

  private buildDebriefPrompt(input: MeetingDebriefDraftInput): string {
    return [
      'Write a concise, lobbyist-ready post-meeting debrief for CRM records.',
      'Use only supplied source text/context. If a detail is missing, omit it. Do not invent facts, attendees, commitments, dates, or policy positions.',
      '',
      'Output structure (JSON fields):',
      'recap: short structured narrative with only these headings:',
      '  - What happened: who attended (if known), core discussion, decisions/commitments explicitly supported by source text.',
      '  - What matters: implications for committee/member/staffer engagement, only when evidenced.',
      '  - Recommended next move: one practical next engagement step grounded in the meeting outcome.',
      '',
      'actionItems: array of concrete, ownable follow-ups. Format: "[Owner], [Action] by [Timing if known]". If owner/timing is not in source, leave it generic instead of guessing.',
      '',
      'notes: brief internal notes for next touch (tone, strategic signal, cautions) only if directly supported by source text.',
      '',
      'Style: direct, brief, and actionable. No fluff. No speculation.',
      'Return JSON only with recap, actionItems, and notes.',
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
      'The email should read as if written by a senior government affairs professional, not generic.',
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
