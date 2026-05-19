import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface LobbyIntelSummary {
  id: string;
  slug: string;
  name: string;
  state: string | null;
  totalSpending: number | null;
  filings: number | null;
  issues: string[];
  years: number[];
  trajectory: string | null;
  growthRate: number | null;
  yearlySpend: { year: number; amount: number }[];
}

export interface LobbyIssue {
  code: string;
  name: string;
  totalSpending: number | null;
  totalFilings: number | null;
  surgeTrend: string | null;
  surgePct: number | null;
  latestQuarter: string | null;
  latestIncome: number | null;
}

export interface LobbyTrendingTopic {
  word: string;
  latestCount: number;
  avgPrior: number | null;
  growthPct: number | null;
  kind: string;
}

export interface LobbyOverview {
  totalClients: number;
  totalIssues: number;
  topSpenders: LobbyIntelSummary[];
  exploding: LobbyIntelSummary[];
  hotIssues: LobbyIssue[];
  surgingIssues: LobbyIssue[];
  trendingTopics: LobbyTrendingTopic[];
  lastSyncedAt: Date | null;
}

/**
 * Service exposing federal lobbying intelligence (OpenLobby / Senate LDA).
 *
 * Tables are GLOBAL (no tenant_id, no RLS) — same dataset for every tenant.
 * Read-only from the API; populated by `pnpm sync:openlobby`.
 */
@Injectable()
export class LobbyIntelService {
  private readonly logger = new Logger(LobbyIntelService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toSummary(row: {
    id: string;
    slug: string;
    name: string;
    state: string | null;
    totalSpending: unknown;
    filings: number | null;
    issues: string[];
    years: number[];
    trajectory: string | null;
    growthRate: number | null;
    yearlySpend: unknown;
  }): LobbyIntelSummary {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      state: row.state,
      totalSpending: row.totalSpending == null ? null : Number(row.totalSpending),
      filings: row.filings,
      issues: row.issues ?? [],
      years: row.years ?? [],
      trajectory: row.trajectory,
      growthRate: row.growthRate,
      yearlySpend: Array.isArray(row.yearlySpend)
        ? (row.yearlySpend as { year: number; amount: number }[])
        : [],
    };
  }

  private toIssue(row: {
    code: string;
    name: string;
    totalSpending: unknown;
    totalFilings: number | null;
    surgeTrend: string | null;
    surgePct: number | null;
    latestQuarter: string | null;
    latestIncome: unknown;
  }): LobbyIssue {
    return {
      code: row.code,
      name: row.name,
      totalSpending: row.totalSpending == null ? null : Number(row.totalSpending),
      totalFilings: row.totalFilings,
      surgeTrend: row.surgeTrend,
      surgePct: row.surgePct,
      latestQuarter: row.latestQuarter,
      latestIncome: row.latestIncome == null ? null : Number(row.latestIncome),
    };
  }

  async overview(): Promise<LobbyOverview> {
    const [topSpenders, exploding, hotIssues, surgingIssues, trendingTopics, total] =
      await Promise.all([
        this.prisma.lobbyIntel.findMany({
          orderBy: { totalSpending: 'desc' },
          take: 20,
        }),
        this.prisma.lobbyIntel.findMany({
          where: { trajectory: 'exploding' },
          orderBy: { totalSpending: 'desc' },
          take: 12,
        }),
        this.prisma.lobbyIssueRef.findMany({
          orderBy: { totalSpending: 'desc' },
          take: 12,
        }),
        this.prisma.lobbyIssueRef.findMany({
          where: { surgeTrend: 'surging' },
          orderBy: { surgePct: 'desc' },
          take: 10,
        }),
        this.prisma.lobbyTrendingTopic.findMany({
          where: { kind: 'trending' },
          orderBy: { growthPct: 'desc' },
          take: 25,
        }),
        this.prisma.lobbyIntel.count(),
      ]);

    const lastSyncedAt =
      topSpenders[0]?.lastSyncedAt ?? hotIssues[0]?.lastSyncedAt ?? null;

    return {
      totalClients: total,
      totalIssues: hotIssues.length,
      topSpenders: topSpenders.map((r) => this.toSummary(r)),
      exploding: exploding.map((r) => this.toSummary(r)),
      hotIssues: hotIssues.map((r) => this.toIssue(r)),
      surgingIssues: surgingIssues.map((r) => this.toIssue(r)),
      trendingTopics: trendingTopics.map((t) => ({
        word: t.word,
        latestCount: t.latestCount,
        avgPrior: t.avgPrior,
        growthPct: t.growthPct,
        kind: t.kind,
      })),
      lastSyncedAt,
    };
  }

  async search(q: string, limit = 25): Promise<LobbyIntelSummary[]> {
    const term = q.trim();
    if (!term) return [];
    const rows = await this.prisma.lobbyIntel.findMany({
      where: { name: { contains: term, mode: 'insensitive' } },
      orderBy: { totalSpending: 'desc' },
      take: Math.max(1, Math.min(limit, 100)),
    });
    return rows.map((r) => this.toSummary(r));
  }

  async getBySlug(slug: string): Promise<LobbyIntelSummary | null> {
    const row = await this.prisma.lobbyIntel.findUnique({ where: { slug } });
    return row ? this.toSummary(row) : null;
  }

  /**
   * Look up federal lobbying intel for a Capiro client by name.
   * Uses Postgres pg_trgm similarity (>= 0.4) for fuzzy matching.
   * Returns the highest-similarity match above the threshold, if any.
   */
  async lookupByClientName(clientName: string): Promise<LobbyIntelSummary | null> {
    const name = clientName.trim();
    if (!name) return null;

    // First try exact (case-insensitive) match.
    const exact = await this.prisma.lobbyIntel.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (exact) return this.toSummary(exact);

    // Then trigram similarity. Requires pg_trgm extension (already enabled).
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        slug: string;
        name: string;
        state: string | null;
        total_spending: string | null;
        filings: number | null;
        issues: string[];
        years: number[];
        trajectory: string | null;
        growth_rate: number | null;
        yearly_spend_jsonb: unknown;
        sim: number;
      }>
    >`
      SELECT id, slug, name, state, total_spending, filings, issues, years,
             trajectory, growth_rate, yearly_spend_jsonb,
             similarity(name, ${name}) AS sim
      FROM lobby_intel
      WHERE name % ${name}
      ORDER BY sim DESC
      LIMIT 1
    `;

    if (!rows.length) return null;
    const r = rows[0];
    if (!r || r.sim < 0.4) return null;

    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      state: r.state,
      totalSpending: r.total_spending == null ? null : Number(r.total_spending),
      filings: r.filings,
      issues: r.issues ?? [],
      years: r.years ?? [],
      trajectory: r.trajectory,
      growthRate: r.growth_rate,
      yearlySpend: Array.isArray(r.yearly_spend_jsonb)
        ? (r.yearly_spend_jsonb as { year: number; amount: number }[])
        : [],
    };
  }

  async listIssues(): Promise<LobbyIssue[]> {
    const rows = await this.prisma.lobbyIssueRef.findMany({
      orderBy: { totalSpending: 'desc' },
    });
    return rows.map((r) => this.toIssue(r));
  }

  /**
   * Compact context payload to inject into AI doc-gen prompts.
   * Keeps token usage low: ~10 hot/surging issues + ~10 trending words.
   */
  async getAiContext(): Promise<{
    surgingIssues: { code: string; name: string; surgePct: number | null }[];
    trendingTopics: { word: string; growthPct: number | null }[];
    latestQuarter: string | null;
  }> {
    const [surging, trending] = await Promise.all([
      this.prisma.lobbyIssueRef.findMany({
        where: { surgeTrend: { in: ['surging', 'growing'] } },
        orderBy: { surgePct: 'desc' },
        take: 10,
      }),
      this.prisma.lobbyTrendingTopic.findMany({
        where: { kind: 'trending' },
        orderBy: { growthPct: 'desc' },
        take: 10,
      }),
    ]);
    return {
      surgingIssues: surging.map((s) => ({
        code: s.code,
        name: s.name,
        surgePct: s.surgePct,
      })),
      trendingTopics: trending.map((t) => ({
        word: t.word,
        growthPct: t.growthPct,
      })),
      latestQuarter: surging[0]?.latestQuarter ?? null,
    };
  }
}
