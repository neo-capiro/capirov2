/**
 * Sync federal lobbying intelligence from OpenLobby (Senate LDA-derived).
 *
 *   pnpm --filter @capiro/api sync:openlobby
 *
 * Pulls ~15 MB of pre-aggregated JSON from https://www.openlobby.us/data/
 * and upserts into three GLOBAL reference tables:
 *   - lobby_intel              (5K federal lobbying clients)
 *   - lobby_issue_ref          (79 LDA issue codes with surge trends)
 *   - lobby_trending_topics    (top + trending words from filing descriptions)
 *
 * Idempotent. Safe to run on cron. Takes ~30-60 seconds.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

dotenvConfig();

const BASE = 'https://www.openlobby.us/data';

interface YearAmount {
  year: number;
  amount: number;
}

interface ClientTrajectory {
  id: string;
  name: string;
  state?: string;
  total: number;
  years: YearAmount[];
  growthRate?: number;
  trajectory?: string;
}

interface TopClient {
  name: string;
  slug: string;
  state?: string;
  totalSpending: number;
  filings: number;
  issues: string[];
  years: number[];
  description?: string;
}

interface IssueIndexRow {
  code: string;
  name: string;
  totalSpending: number;
  totalFilings: number;
}

interface SurgeRow {
  code: string;
  name: string;
  latestQuarter: string;
  latestIncome: number;
  incomeChangePercent: number;
  trend: string;
}

interface SurgeTracker {
  surging: SurgeRow[];
  growing: SurgeRow[];
  stable: SurgeRow[];
  declining: SurgeRow[];
}

interface ClientTrajectoryDataset {
  topByTotal: ClientTrajectory[];
  exploding: ClientTrajectory[];
  declining: ClientTrajectory[];
  newEntries: ClientTrajectory[];
}

interface TextAnalysis {
  topWords: { word: string; count: number }[];
  trendingWords: {
    word: string;
    latestCount: number;
    avgPrior: number;
    growthPercent: number;
  }[];
}

async function fetchJson<T>(name: string): Promise<T> {
  const url = `${BASE}/${name}`;
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch (err) {
    throw new Error(`Network error fetching ${url}: ${err instanceof Error ? err.message : err}`);
  }
  if (!resp.ok) {
    throw new Error(`Fetch ${url} failed: ${resp.status} ${resp.statusText}`);
  }
  return (await resp.json()) as T;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[openlobby-sync] starting');

  try {
    // ── 1. Issue index + surge tracker → lobby_issue_ref ──
    console.log('[openlobby-sync] fetching issue-index.json + surge-tracker.json');
    const [issueIndex, surgeTracker] = await Promise.all([
      fetchJson<IssueIndexRow[]>('issue-index.json'),
      fetchJson<SurgeTracker>('surge-tracker.json'),
    ]);

    const surgeByCode = new Map<string, SurgeRow>();
    for (const row of [
      ...surgeTracker.surging,
      ...surgeTracker.growing,
      ...surgeTracker.stable,
      ...surgeTracker.declining,
    ]) {
      surgeByCode.set(row.code, row);
    }

    let issueCount = 0;
    for (const iss of issueIndex) {
      if (!iss?.code) continue;
      const surge = surgeByCode.get(iss.code);
      try {
        await prisma.lobbyIssueRef.upsert({
          where: { code: iss.code },
          update: {
            name: iss.name,
            totalSpending: iss.totalSpending ?? null,
            totalFilings: iss.totalFilings ?? null,
            surgeTrend: surge?.trend ?? null,
            surgePct: surge?.incomeChangePercent ?? null,
            latestQuarter: surge?.latestQuarter ?? null,
            latestIncome: surge?.latestIncome ?? null,
            lastSyncedAt: new Date(),
          },
          create: {
            code: iss.code,
            name: iss.name,
            totalSpending: iss.totalSpending ?? null,
            totalFilings: iss.totalFilings ?? null,
            surgeTrend: surge?.trend ?? null,
            surgePct: surge?.incomeChangePercent ?? null,
            latestQuarter: surge?.latestQuarter ?? null,
            latestIncome: surge?.latestIncome ?? null,
          },
        });
        issueCount++;
      } catch (err) {
        console.warn(`[openlobby-sync] skip issue ${iss.code}:`, (err as Error).message);
      }
    }
    console.log(`[openlobby-sync] upserted ${issueCount} issue codes`);

    // ── 2. Top clients + client trajectories → lobby_intel ──
    console.log('[openlobby-sync] fetching top-clients.json + client-trajectories.json');
    const [topClients, trajectories] = await Promise.all([
      fetchJson<TopClient[]>('top-clients.json'),
      fetchJson<ClientTrajectoryDataset>('client-trajectories.json'),
    ]);

    // Build trajectory lookup by name (uppercase keyed, since trajectory names
    // are ALL CAPS and top-clients are also ALL CAPS in the source).
    const trajByName = new Map<
      string,
      { trajectory: string; growthRate?: number; years: YearAmount[] }
    >();
    const addTraj = (rows: ClientTrajectory[], label: string) => {
      for (const r of rows) {
        trajByName.set(r.name.toUpperCase(), {
          trajectory: r.trajectory ?? label,
          growthRate: r.growthRate,
          years: r.years ?? [],
        });
      }
    };
    addTraj(trajectories.topByTotal, 'steady');
    addTraj(trajectories.exploding, 'exploding');
    addTraj(trajectories.declining, 'declining');
    addTraj(trajectories.newEntries, 'new');

    let clientCount = 0;
    // Batch upserts in chunks to avoid hammering the DB.
    const chunk = 200;
    for (let i = 0; i < topClients.length; i += chunk) {
      const batch = topClients.slice(i, i + chunk);
      await Promise.all(
        batch.map(async (c) => {
          if (!c?.name) return;
          const slug = c.slug || slugify(c.name);
          const traj = trajByName.get(c.name.toUpperCase());
          // Build yearlySpend: prefer trajectory's per-year amounts; fall back
          // to an empty list (the source top-clients.json only has year tags,
          // not amounts).
          const yearlySpend = traj?.years ?? [];
          // Source data occasionally contains null entries in arrays — strip them.
          const cleanIssues = (c.issues ?? []).filter(
            (s): s is string => typeof s === 'string' && s.length > 0,
          );
          const cleanYears = (c.years ?? []).filter(
            (y): y is number => typeof y === 'number' && Number.isFinite(y),
          );
          try {
            await prisma.lobbyIntel.upsert({
              where: { slug },
              update: {
                name: c.name,
                state: c.state ?? null,
                totalSpending: c.totalSpending ?? null,
                filings: c.filings ?? null,
                issues: cleanIssues,
                years: cleanYears,
                trajectory: traj?.trajectory ?? null,
                growthRate: traj?.growthRate ?? null,
                yearlySpend: yearlySpend as object,
                source: 'openlobby',
                lastSyncedAt: new Date(),
                raw: c as object,
              },
              create: {
                id: randomUUID(),
                slug,
                name: c.name,
                state: c.state ?? null,
                totalSpending: c.totalSpending ?? null,
                filings: c.filings ?? null,
                issues: cleanIssues,
                years: cleanYears,
                trajectory: traj?.trajectory ?? null,
                growthRate: traj?.growthRate ?? null,
                yearlySpend: yearlySpend as object,
                raw: c as object,
              },
            });
            clientCount++;
          } catch (err) {
            console.warn(`[openlobby-sync] skip client ${slug}:`, (err as Error).message);
          }
        }),
      );
      if (i % 1000 === 0 && i > 0) {
        console.log(`[openlobby-sync]   ${i}/${topClients.length} clients...`);
      }
    }
    console.log(`[openlobby-sync] upserted ${clientCount} clients`);

    // ── 3. Trending words / top words → lobby_trending_topics ──
    console.log('[openlobby-sync] fetching text-analysis.json');
    const text = await fetchJson<TextAnalysis>('text-analysis.json');

    // Wipe existing topics + re-insert (small dataset, simpler than diff).
    await prisma.lobbyTrendingTopic.deleteMany({});

    const trendingRows = text.trendingWords
      .filter((w) => w.word && w.latestCount > 0)
      .slice(0, 200)
      .map((w) => ({
        id: randomUUID(),
        word: w.word.toLowerCase(),
        latestCount: w.latestCount,
        avgPrior: w.avgPrior,
        growthPct: w.growthPercent,
        kind: 'trending' as const,
      }));

    const topRows = text.topWords.slice(0, 100).map((w) => ({
      id: randomUUID(),
      word: w.word.toLowerCase(),
      latestCount: w.count,
      avgPrior: null as number | null,
      growthPct: null as number | null,
      kind: 'top' as const,
    }));

    // De-dupe on word (trending takes precedence).
    const seen = new Set<string>();
    const all: typeof trendingRows = [];
    for (const r of [...trendingRows, ...topRows]) {
      if (seen.has(r.word)) continue;
      seen.add(r.word);
      all.push(r as (typeof trendingRows)[number]);
    }
    await prisma.lobbyTrendingTopic.createMany({ data: all });
    console.log(`[openlobby-sync] inserted ${all.length} trending topics`);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[openlobby-sync] DONE in ${elapsed}s`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[openlobby-sync] FAILED', err);
  process.exit(1);
});
