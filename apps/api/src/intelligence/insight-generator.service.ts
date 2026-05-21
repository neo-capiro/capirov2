import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { AppConfig } from '../config/config.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
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
      throw new ServiceUnavailableException(`AI request timed out after ${AI_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
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
  if (!trimmed) throw new ServiceUnavailableException('AI returned empty response');
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new ServiceUnavailableException('AI returned non-JSON output');
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const SYSTEM_PROMPT = `You are a senior federal government affairs analyst at a top-tier lobbying firm. Generate actionable intelligence insights from the provided data. Each insight must:
1. State a specific, verifiable finding (not a generic observation)
2. Explain WHY it matters to a government affairs professional
3. Suggest a concrete next step (meeting, filing, outreach, monitoring)
4. Reference the specific data that supports the finding

Do not invent facts. Do not speculate beyond what the data supports. If there is nothing notable, return an empty insights array.`;

const INSIGHTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['insights'],
  properties: {
    insights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'title', 'body', 'severity', 'suggestedAction', 'dataPoints'],
        properties: {
          category: { type: 'string', enum: ['market_shift', 'competitive_move', 'regulatory_alert', 'legislative_signal', 'client_opportunity', 'risk_flag'] },
          title: { type: 'string' },
          body: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'notable', 'critical'] },
          suggestedAction: { type: 'string' },
          dataPoints: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['source', 'metric', 'value'],
              properties: {
                source: { type: 'string' },
                metric: { type: 'string' },
                value: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

const BRIEFING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['briefing', 'keyFindings'],
  properties: {
    briefing: { type: 'string' },
    keyFindings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'metric', 'value'],
        properties: {
          source: { type: 'string' },
          metric: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
  },
};

@Injectable()
export class InsightGeneratorService {
  private readonly logger = new Logger(InsightGeneratorService.name);
  private readonly openaiKey?: string;
  private readonly anthropicKey?: string;
  private readonly preferredProvider?: 'openai' | 'anthropic';
  private readonly openaiModel: string;
  private readonly anthropicModel: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
    private readonly lobbyIntel: LobbyIntelService,
    private readonly federalSpending: FederalSpendingService,
  ) {
    this.openaiKey = config.get('OPENAI_API_KEY', { infer: true });
    this.anthropicKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.preferredProvider = config.get('AI_PROVIDER', { infer: true });
    this.openaiModel = config.get('OPENAI_MODEL', { infer: true });
    this.anthropicModel = config.get('ANTHROPIC_MODEL', { infer: true });
  }

  /** Generate market-wide intelligence insights from lobby intel + spending data */
  async generateMarketInsights() {
    const [lobbyCtx, spendCtx] = await Promise.all([
      this.lobbyIntel.getAiContext().catch(() => null),
      this.federalSpending.getAiContext(null).catch(() => null),
    ]);

    const contextParts: string[] = [];
    if (lobbyCtx) {
      const surge = lobbyCtx.surgingIssues
        .slice(0, 10)
        .map((s) => `${s.code} (${s.name}): ${s.surgePct != null ? `+${Math.round(s.surgePct)}% QoQ` : 'surging'}`)
        .join('\n');
      const trending = lobbyCtx.trendingTopics.slice(0, 15).map((t) => t.word).join(', ');
      if (surge) contextParts.push(`SURGING LDA ISSUES (latest quarter: ${lobbyCtx.latestQuarter ?? 'unknown'}):\n${surge}`);
      if (trending) contextParts.push(`TRENDING TERMS IN FILINGS: ${trending}`);
    }
    if (spendCtx?.topAgencyTotals?.length) {
      const agencies = spendCtx.topAgencyTotals
        .slice(0, 8)
        .map((a) => `${a.name}: ${a.budget ? `$${(a.budget / 1e12).toFixed(1)}T budget` : 'budget unknown'}`)
        .join('\n');
      contextParts.push(`TOP FEDERAL AGENCIES BY BUDGET:\n${agencies}`);
    }

    if (!contextParts.length) {
      return { insights: [], message: 'No intelligence data available for analysis' };
    }

    const prompt = `Analyze the following federal lobbying and government spending data. Generate 3-5 actionable intelligence insights for government affairs professionals.\n\n${contextParts.join('\n\n')}`;

    const result = await this.callAi(prompt, INSIGHTS_SCHEMA);
    const parsed = parseJsonObject(result.text);
    const insights = Array.isArray(parsed.insights) ? parsed.insights : [];

    // Save to DB
    const saved = [];
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    for (const ins of insights.slice(0, 10)) {
      const record = toRecord(ins);
      const row = await this.prisma.intelligenceInsight.create({
        data: {
          category: typeof record.category === 'string' ? record.category : 'market_shift',
          title: typeof record.title === 'string' ? record.title : 'Untitled',
          body: typeof record.body === 'string' ? record.body : '',
          severity: typeof record.severity === 'string' ? record.severity : 'info',
          dataPoints: record.dataPoints ? (record.dataPoints as Prisma.InputJsonValue) : Prisma.JsonNull,
          expiresAt,
        },
      });
      saved.push(row);
    }

    return { insights: saved, provider: result.provider, model: result.model };
  }

  /** Generate a detailed executive briefing for a specific CRM client */
  async generateClientBriefing(clientId: string, tenantId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId },
      include: { capabilities: true },
    });
    if (!client) throw new NotFoundException('Client not found');

    // Gather context
    const [lobbyCtx, spendCtx] = await Promise.all([
      this.lobbyIntel.getAiContext().catch(() => null),
      this.federalSpending.getAiContext(client.name).catch(() => null),
    ]);

    // Fuzzy match against LDA
    const ldaMatch = await this.prisma.$queryRaw<
      Array<{ name: string; total_filings: number; total_spending: number | null; issue_codes: string[]; similarity: number }>
    >`
      SELECT name, total_filings, total_spending, COALESCE(issue_codes, '{}') as issue_codes,
             similarity(name, ${client.name}) as similarity
      FROM lda_client WHERE similarity(name, ${client.name}) > 0.3
      ORDER BY similarity DESC LIMIT 1
    `.catch(() => []);

    const contextParts: string[] = [];
    contextParts.push(`CLIENT: ${client.name}`);
    if (client.description) contextParts.push(`DESCRIPTION: ${client.description}`);

    const capabilities = (client.capabilities ?? []).map((c) => c.name).filter(Boolean);
    if (capabilities.length) contextParts.push(`CAPABILITIES: ${capabilities.join(', ')}`);

    if (ldaMatch.length) {
      const m = ldaMatch[0]!;
      contextParts.push(`LDA MATCH: ${m.name} (${Math.round(m.similarity * 100)}% confidence)`);
      contextParts.push(`  Total filings: ${m.total_filings}, Total spending: ${m.total_spending ? `$${(m.total_spending / 1e6).toFixed(1)}M` : 'unknown'}`);
      if (m.issue_codes.length) contextParts.push(`  Active issue areas: ${m.issue_codes.join(', ')}`);
    }

    if (spendCtx?.matchedContractor) {
      const mc = spendCtx.matchedContractor;
      contextParts.push(`FEDERAL CONTRACTOR MATCH: ${mc.name}`);
      contextParts.push(`  Total contracts: ${mc.totalContracts ? `$${(mc.totalContracts / 1e9).toFixed(1)}B` : 'unknown'}, Rank: #${mc.rankByContracts ?? 'unknown'}`);
      if (mc.topAgencies?.length) {
        contextParts.push(`  Top agencies: ${mc.topAgencies.slice(0, 5).map((a) => a.name).join(', ')}`);
      }
    }

    if (lobbyCtx) {
      const relevantSurges = lobbyCtx.surgingIssues.slice(0, 5)
        .map((s) => `${s.code} (${s.name}): +${Math.round(s.surgePct ?? 0)}%`)
        .join('; ');
      if (relevantSurges) contextParts.push(`MARKET CONTEXT — SURGING ISSUES: ${relevantSurges}`);
    }

    // Get recent regulations with open comment periods
    const openRegs = await this.prisma.federalRegisterDocument.findMany({
      where: { commentEndDate: { gt: new Date() } },
      orderBy: { commentEndDate: 'asc' },
      take: 5,
      select: { title: true, type: true, commentEndDate: true, agencyNames: true },
    });
    if (openRegs.length) {
      const regList = openRegs.map((r) => {
        const daysLeft = Math.ceil((r.commentEndDate!.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        return `${r.title} (${r.type}, ${daysLeft}d left, ${(r.agencyNames as string[]).join('/')})`;
      }).join('\n  ');
      contextParts.push(`OPEN COMMENT PERIODS:\n  ${regList}`);
    }

    const prompt = `Write a 3-5 paragraph executive intelligence briefing for the following government affairs client. Cover: (1) their lobbying landscape and spending trends, (2) regulatory exposure and upcoming deadlines, (3) competitive dynamics in their issue areas, and (4) recommended next steps. Be specific and actionable — this is for a senior lobbyist, not a general audience.\n\n${contextParts.join('\n')}`;

    const result = await this.callAi(prompt, BRIEFING_SCHEMA, 'briefing');
    const parsed = parseJsonObject(result.text);

    return {
      briefing: typeof parsed.briefing === 'string' ? parsed.briefing : '',
      generatedAt: new Date().toISOString(),
      dataPoints: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
      provider: result.provider,
      model: result.model,
    };
  }

  /** Generate insights from change events */
  async generateFromChanges(changes: Array<{ source: string; changeType: string; title: string; description: string }>) {
    if (!changes.length) return { insights: [], message: 'No changes to analyze' };

    const changeList = changes.slice(0, 20).map((c) =>
      `[${c.source}/${c.changeType}] ${c.title}: ${c.description}`
    ).join('\n');

    const prompt = `The following changes were detected in federal government data sources. Identify the 2-4 most actionable intelligence insights for government affairs professionals.\n\nCHANGES:\n${changeList}`;

    const result = await this.callAi(prompt, INSIGHTS_SCHEMA);
    const parsed = parseJsonObject(result.text);
    const insights = Array.isArray(parsed.insights) ? parsed.insights : [];

    const saved = [];
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
    for (const ins of insights.slice(0, 5)) {
      const record = toRecord(ins);
      const row = await this.prisma.intelligenceInsight.create({
        data: {
          category: typeof record.category === 'string' ? record.category : 'market_shift',
          title: typeof record.title === 'string' ? record.title : 'Untitled',
          body: typeof record.body === 'string' ? record.body : '',
          severity: typeof record.severity === 'string' ? record.severity : 'info',
          dataPoints: record.dataPoints ? (record.dataPoints as Prisma.InputJsonValue) : Prisma.JsonNull,
          expiresAt,
        },
      });
      saved.push(row);
    }

    return { insights: saved, provider: result.provider, model: result.model };
  }

  /** Fetch existing insights from the DB */
  async getInsights(category?: string, severity?: string, limit = 20) {
    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (severity) where.severity = severity;

    return this.prisma.intelligenceInsight.findMany({
      where: { ...where, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { generatedAt: 'desc' },
      take: Math.min(limit, 50),
    });
  }

  // ── AI provider abstraction ────────────────────────────────────────────

  private async callAi(
    prompt: string,
    schema: Record<string, unknown>,
    schemaName = 'insights',
  ): Promise<{ text: string; provider: string; model: string }> {
    return this.withProviderFallback('Insight generation', async (provider) => {
      if (provider === 'openai') {
        return this.callOpenAi(prompt, schema, schemaName);
      } else {
        return this.callAnthropic(prompt, schema);
      }
    });
  }

  private async callOpenAi(prompt: string, schema: Record<string, unknown>, schemaName: string) {
    if (!this.openaiKey) throw new ServiceUnavailableException('OPENAI_API_KEY not configured');
    const res = await fetchWithTimeout('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.openaiModel,
        instructions: SYSTEM_PROMPT,
        input: prompt,
        text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new ServiceUnavailableException(`OpenAI failed: ${JSON.stringify(json).slice(0, 200)}`);
    return { text: extractOpenAiText(json), provider: 'openai' as const, model: this.openaiModel };
  }

  private async callAnthropic(prompt: string, schema: Record<string, unknown>) {
    if (!this.anthropicKey) throw new ServiceUnavailableException('ANTHROPIC_API_KEY not configured');
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.anthropicModel,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `${prompt}\n\nReturn JSON matching this schema:\n${JSON.stringify(schema)}` },
        ],
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new ServiceUnavailableException(`Anthropic failed: ${JSON.stringify(json).slice(0, 200)}`);
    return { text: extractAnthropicText(json), provider: 'anthropic' as const, model: this.anthropicModel };
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
    const add = (p: 'openai' | 'anthropic') => {
      if ((p === 'openai' ? this.openaiKey : this.anthropicKey) && !providers.includes(p)) providers.push(p);
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
        `${operation} not configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.`,
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
          this.logger.warn(`${operation} failed with ${provider}; trying fallback. ${message}`);
        }
      }
    }
    throw new ServiceUnavailableException(
      `${operation} failed for all providers. ${failures.join(' | ')}`,
    );
  }
}
