import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

type LobbyIntelSource = 'lda' | 'openlobby';

interface MvRow {
  id: string;
  slug: string;
  name: string;
  state: string | null;
  total_spending: string | null;
  filings: number | null;
  issues: string[] | null;
  years: number[] | null;
  trajectory: string | null;
  growth_rate: number | null;
  yearly_spend: unknown;
  last_synced_at: Date | null;
}

interface IssueRow {
  code: string;
  name: string;
  total_spending: string | null;
  total_filings: number | null;
  surge_trend: string | null;
  surge_pct: number | null;
  latest_quarter: string | null;
  latest_income: string | null;
  last_synced_at: Date | null;
}

/**
 * Service exposing federal lobbying intelligence.
 *
 * Tables/views are GLOBAL (no tenant_id, no RLS), same dataset for every tenant.
 *
 * Reads from one of two sources depending on LOBBY_INTEL_SOURCE env var:
 *   - 'lda'        (default): the lobby_intel_mv materialized view + lobby_issue_ref_v
 *                  view, both computed from raw Senate LDA filings already in
 *                  lda_filing / lda_client / lda_issue_code. Refreshed on a
 *                  schedule via refresh_lobby_intel_mv().
 *   - 'openlobby'  (legacy rollback): the lobby_intel + lobby_issue_ref tables
 *                  populated by sync-openlobby.ts. Kept for emergency rollback;
 *                  scheduled for removal once the LDA source is verified.
 *
 * The public API surface is identical across both sources, Clio + chat tools
 * call getAiContext() and lookupByClientName() and must not notice the switch.
 */
@Injectable()
export class LobbyIntelService {
  private readonly logger = new Logger(LobbyIntelService.name);
  private readonly source: LobbyIntelSource;

  constructor(private readonly prisma: PrismaService) {
    const raw = (process.env.LOBBY_INTEL_SOURCE ?? 'lda').toLowerCase();
    this.source = raw === 'openlobby' ? 'openlobby' : 'lda';
    this.logger.log(`LobbyIntelService source = ${this.source}`);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async overview(): Promise<LobbyOverview> {
    return this.source === 'lda' ? this.overviewLda() : this.overviewOpenLobby();
  }

  async search(q: string, limit = 25): Promise<LobbyIntelSummary[]> {
    const term = q.trim();
    if (!term) return [];
    const cap = Math.max(1, Math.min(limit, 100));
    return this.source === 'lda' ? this.searchLda(term, cap) : this.searchOpenLobby(term, cap);
  }

  async getBySlug(slug: string): Promise<LobbyIntelSummary | null> {
    return this.source === 'lda' ? this.getBySlugLda(slug) : this.getBySlugOpenLobby(slug);
  }

  /**
   * Look up federal lobbying intel for a Capiro client by name.
   * Uses Postgres pg_trgm similarity (>= 0.4) for fuzzy matching.
   */
  async lookupByClientName(clientName: string): Promise<LobbyIntelSummary | null> {
    const name = clientName.trim();
    if (!name) return null;
    return this.source === 'lda'
      ? this.lookupByClientNameLda(name)
      : this.lookupByClientNameOpenLobby(name);
  }

  async listIssues(): Promise<LobbyIssue[]> {
    return this.source === 'lda' ? this.listIssuesLda() : this.listIssuesOpenLobby();
  }

  /**
   * Compact context payload to inject into AI doc-gen prompts.
   * Used by Clio's query_intelligence tool and the chat bot.
   * Keeps token usage low: ~10 hot/surging issues + ~10 trending words.
   */
  async getAiContext(): Promise<{
    surgingIssues: { code: string; name: string; surgePct: number | null }[];
    trendingTopics: { word: string; growthPct: number | null }[];
    latestQuarter: string | null;
  }> {
    const [surging, trending] = await Promise.all([
      this.surgingIssuesRows(10),
      this.trendingTopicsRows(10),
    ]);
    return {
      surgingIssues: surging.map((s) => ({ code: s.code, name: s.name, surgePct: s.surgePct })),
      trendingTopics: trending.map((t) => ({ word: t.word, growthPct: t.growthPct })),
      latestQuarter: surging[0]?.latestQuarter ?? null,
    };
  }

  // ── LDA-backed implementation (default) ─────────────────────────────────

  private async overviewLda(): Promise<LobbyOverview> {
    const [topSpenders, exploding, hotIssues, surgingIssues, trendingTopics, total] =
      await Promise.all([
        this.prisma.$queryRaw<MvRow[]>`
          SELECT * FROM lobby_intel_mv
          ORDER BY total_spending DESC NULLS LAST
          LIMIT 20
        `,
        this.prisma.$queryRaw<MvRow[]>`
          SELECT * FROM lobby_intel_mv
          WHERE trajectory = 'exploding'
          ORDER BY total_spending DESC NULLS LAST
          LIMIT 12
        `,
        this.prisma.$queryRaw<IssueRow[]>`
          SELECT * FROM lobby_issue_ref_v
          ORDER BY total_spending DESC NULLS LAST
          LIMIT 12
        `,
        this.prisma.$queryRaw<IssueRow[]>`
          SELECT * FROM lobby_issue_ref_v
          WHERE surge_trend = 'surging'
          ORDER BY surge_pct DESC NULLS LAST
          LIMIT 10
        `,
        this.trendingTopicsRows(25),
        this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*)::bigint AS count FROM lobby_intel_mv
        `,
      ]);

    const lastSyncedAt = topSpenders[0]?.last_synced_at ?? hotIssues[0]?.last_synced_at ?? null;

    return {
      totalClients: Number(total[0]?.count ?? 0),
      totalIssues: hotIssues.length,
      topSpenders: topSpenders.map((r) => this.mapMvRow(r)),
      exploding: exploding.map((r) => this.mapMvRow(r)),
      hotIssues: hotIssues.map((r) => this.mapIssueRow(r)),
      surgingIssues: surgingIssues.map((r) => this.mapIssueRow(r)),
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

  private async searchLda(term: string, limit: number): Promise<LobbyIntelSummary[]> {
    // Trigram match for typo tolerance, fall back to ILIKE if pg_trgm
    // similarity is below threshold.
    const rows = await this.prisma.$queryRaw<MvRow[]>`
      SELECT *, GREATEST(similarity(name, ${term}), 0) AS sim
      FROM lobby_intel_mv
      WHERE name ILIKE ${'%' + term + '%'} OR name % ${term}
      ORDER BY total_spending DESC NULLS LAST
      LIMIT ${Prisma.raw(limit.toString())}
    `;
    return rows.map((r) => this.mapMvRow(r));
  }

  private async getBySlugLda(slug: string): Promise<LobbyIntelSummary | null> {
    const rows = await this.prisma.$queryRaw<MvRow[]>`
      SELECT * FROM lobby_intel_mv WHERE slug = ${slug} LIMIT 1
    `;
    return rows[0] ? this.mapMvRow(rows[0]) : null;
  }

  private async lookupByClientNameLda(name: string): Promise<LobbyIntelSummary | null> {
    // Exact (case-insensitive) first.
    const exact = await this.prisma.$queryRaw<MvRow[]>`
      SELECT * FROM lobby_intel_mv
      WHERE lower(name) = lower(${name})
      LIMIT 1
    `;
    if (exact[0]) return this.mapMvRow(exact[0]);

    // Trigram fallback.
    const rows = await this.prisma.$queryRaw<(MvRow & { sim: number })[]>`
      SELECT *, similarity(name, ${name}) AS sim
      FROM lobby_intel_mv
      WHERE name % ${name}
      ORDER BY sim DESC
      LIMIT 1
    `;
    const top = rows[0];
    if (!top || top.sim < 0.4) return null;
    return this.mapMvRow(top);
  }

  private async listIssuesLda(): Promise<LobbyIssue[]> {
    const rows = await this.prisma.$queryRaw<IssueRow[]>`
      SELECT * FROM lobby_issue_ref_v
      ORDER BY total_spending DESC NULLS LAST
    `;
    return rows.map((r) => this.mapIssueRow(r));
  }

  // ── Shared trending-topics + surging-issues read paths ──────────────────
  //
  // lobby_trending_topics is still a real table (repopulated from
  // lda_filing.lobbying_activities by sync-lobby-trending.ts). The same query
  // works regardless of which lobby-intel source is active.

  private async trendingTopicsRows(limit: number): Promise<LobbyTrendingTopic[]> {
    const rows = await this.prisma.lobbyTrendingTopic.findMany({
      where: { kind: 'trending' },
      orderBy: { growthPct: 'desc' },
      take: limit,
    });
    return rows.map((t) => ({
      word: t.word,
      latestCount: t.latestCount,
      avgPrior: t.avgPrior,
      growthPct: t.growthPct,
      kind: t.kind,
    }));
  }

  private async surgingIssuesRows(limit: number): Promise<LobbyIssue[]> {
    if (this.source === 'lda') {
      const rows = await this.prisma.$queryRaw<IssueRow[]>`
        SELECT * FROM lobby_issue_ref_v
        WHERE surge_trend IN ('surging', 'growing')
        ORDER BY surge_pct DESC NULLS LAST
        LIMIT ${Prisma.raw(limit.toString())}
      `;
      return rows.map((r) => this.mapIssueRow(r));
    }
    const rows = await this.prisma.lobbyIssueRef.findMany({
      where: { surgeTrend: { in: ['surging', 'growing'] } },
      orderBy: { surgePct: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.mapLegacyIssue(r));
  }

  // ── Legacy OpenLobby-backed implementation (rollback) ───────────────────

  private async overviewOpenLobby(): Promise<LobbyOverview> {
    const [topSpenders, exploding, hotIssues, surgingIssues, trendingTopics, total] =
      await Promise.all([
        this.prisma.lobbyIntel.findMany({ orderBy: { totalSpending: 'desc' }, take: 20 }),
        this.prisma.lobbyIntel.findMany({
          where: { trajectory: 'exploding' },
          orderBy: { totalSpending: 'desc' },
          take: 12,
        }),
        this.prisma.lobbyIssueRef.findMany({ orderBy: { totalSpending: 'desc' }, take: 12 }),
        this.prisma.lobbyIssueRef.findMany({
          where: { surgeTrend: 'surging' },
          orderBy: { surgePct: 'desc' },
          take: 10,
        }),
        this.trendingTopicsRows(25),
        this.prisma.lobbyIntel.count(),
      ]);

    const lastSyncedAt = topSpenders[0]?.lastSyncedAt ?? hotIssues[0]?.lastSyncedAt ?? null;

    return {
      totalClients: total,
      totalIssues: hotIssues.length,
      topSpenders: topSpenders.map((r) => this.mapLegacyClient(r)),
      exploding: exploding.map((r) => this.mapLegacyClient(r)),
      hotIssues: hotIssues.map((r) => this.mapLegacyIssue(r)),
      surgingIssues: surgingIssues.map((r) => this.mapLegacyIssue(r)),
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

  private async searchOpenLobby(term: string, limit: number): Promise<LobbyIntelSummary[]> {
    const rows = await this.prisma.lobbyIntel.findMany({
      where: { name: { contains: term, mode: 'insensitive' } },
      orderBy: { totalSpending: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.mapLegacyClient(r));
  }

  private async getBySlugOpenLobby(slug: string): Promise<LobbyIntelSummary | null> {
    const row = await this.prisma.lobbyIntel.findUnique({ where: { slug } });
    return row ? this.mapLegacyClient(row) : null;
  }

  private async lookupByClientNameOpenLobby(name: string): Promise<LobbyIntelSummary | null> {
    const exact = await this.prisma.lobbyIntel.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (exact) return this.mapLegacyClient(exact);

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
        yearly_spend: unknown;
        sim: number;
      }>
    >`
      SELECT id, slug, name, state, total_spending, filings, issues, years,
             trajectory, growth_rate, yearly_spend,
             similarity(name, ${name}) AS sim
      FROM lobby_intel_mv
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
      yearlySpend: Array.isArray(r.yearly_spend)
        ? (r.yearly_spend as { year: number; amount: number }[])
        : [],
    };
  }

  private async listIssuesOpenLobby(): Promise<LobbyIssue[]> {
    const rows = await this.prisma.lobbyIssueRef.findMany({ orderBy: { totalSpending: 'desc' } });
    return rows.map((r) => this.mapLegacyIssue(r));
  }

  // ── Refresh hook (LDA source only) ──────────────────────────────────────

  /** Refresh the lobby_intel_mv materialized view. Called by the scheduled
   *  refresher and exposed for ops-triggered refresh. No-op for openlobby source. */
  async refreshMaterializedView(): Promise<void> {
    if (this.source !== 'lda') return;
    await this.prisma.$executeRawUnsafe('SELECT refresh_lobby_intel_mv()');
    this.logger.log('Refreshed lobby_intel_mv');
  }

  // ── Row mappers ─────────────────────────────────────────────────────────

  private mapMvRow(row: MvRow): LobbyIntelSummary {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      state: row.state,
      totalSpending: row.total_spending == null ? null : Number(row.total_spending),
      filings: row.filings,
      issues: row.issues ?? [],
      years: row.years ?? [],
      trajectory: row.trajectory,
      growthRate: row.growth_rate,
      yearlySpend: Array.isArray(row.yearly_spend)
        ? (row.yearly_spend as { year: number; amount: number }[])
        : [],
    };
  }

  private mapIssueRow(row: IssueRow): LobbyIssue {
    return {
      code: row.code,
      name: row.name,
      totalSpending: row.total_spending == null ? null : Number(row.total_spending),
      totalFilings: row.total_filings,
      surgeTrend: row.surge_trend,
      surgePct: row.surge_pct,
      latestQuarter: row.latest_quarter,
      latestIncome: row.latest_income == null ? null : Number(row.latest_income),
    };
  }

  private mapLegacyClient(row: {
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

  private mapLegacyIssue(row: {
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
}
