/**
 * Sync trending lobbying terms from lda_filing.lobbying_activities descriptions.
 *
 *   pnpm --filter @capiro/api sync:lobby-trending
 *
 * Replaces the external openlobby.us text-analysis fetch with tokenization
 * of the descriptions we already have in lda_filing.lobbying_activities (JSONB).
 *
 * For each word that appears in the most-recent quarter's filings, computes:
 *   - latestCount      — frequency in the latest quarter
 *   - avgPrior         — average frequency across the 4 prior quarters
 *   - growthPct        — (latestCount - avgPrior) / max(avgPrior, 1) * 100
 *
 * Writes the top-200 trending words + top-100 absolute frequency words to
 * lobby_trending_topics (delete-then-create — small dataset).
 *
 * Idempotent. Safe to run on cron. Takes ~10s with 50K filings.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

dotenvConfig();

// Common English stopwords + LDA boilerplate that dominates filings without
// being informative. Kept short on purpose — pgvector/embeddings would handle
// this better long-term; for now keyword extraction is fine.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'are', 'was', 'were', 'has',
  'have', 'had', 'will', 'would', 'should', 'could', 'may', 'might', 'must',
  'from', 'into', 'onto', 'than', 'such', 'also', 'but', 'not', 'all', 'any',
  'its', 'their', 'them', 'they', 'these', 'those', 'which', 'who', 'whom',
  'what', 'when', 'where', 'why', 'how', 'about', 'into', 'over', 'under',
  'between', 'among', 'through', 'during', 'before', 'after', 'above', 'below',
  // LDA filing boilerplate
  'issues', 'related', 'including', 'regarding', 'concerning', 'pertaining',
  'legislation', 'regulations', 'regulation', 'regulatory', 'federal', 'agency',
  'agencies', 'department', 'congress', 'congressional', 'house', 'senate',
  'committee', 'subcommittee', 'bill', 'bills', 'act', 'acts', 'public', 'policy',
  'policies', 'rules', 'rule', 'matters', 'matter', 'general', 'specific',
  'various', 'other', 'see', 'attached', 'sheet', 'addendum', 'page', 'pages',
  'continued', 'na', 'none',
]);

interface QuarterBucket {
  /** Year * 10 + quarter (1-4). Sortable. */
  ord: number;
  year: number;
  period: string;
  /** Counter of word → occurrences in this quarter. */
  counts: Map<string, number>;
}

const PERIOD_TO_QUARTER: Record<string, number> = {
  first_quarter: 1,
  second_quarter: 2,
  third_quarter: 3,
  fourth_quarter: 4,
  mid_year: 2,
  year_end: 4,
};

function extractWords(text: unknown): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const words: string[] = [];
  // Match alpha sequences ≥ 4 chars; drop digits + punctuation.
  const matches = text.toLowerCase().matchAll(/[a-z][a-z'-]{3,}/g);
  for (const m of matches) {
    const w = m[0].replace(/[''-]/g, '');
    if (w.length < 4 || w.length > 32) continue;
    if (STOPWORDS.has(w)) continue;
    words.push(w);
  }
  return words;
}

interface ActivityRow {
  description: string | null;
  general_issue_code_display?: string | null;
}

function descriptionsFromActivities(activities: unknown): string[] {
  if (!Array.isArray(activities)) return [];
  const out: string[] = [];
  for (const a of activities) {
    if (a && typeof a === 'object') {
      const row = a as ActivityRow;
      if (typeof row.description === 'string' && row.description.length > 4) {
        out.push(row.description);
      }
    }
  }
  return out;
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[lobby-trending-sync] starting');

  try {
    // Fetch the last 5 quarters of filings. We rank by quarter_ord descending
    // and bucket into 5 windows — the latest plus 4 prior.
    const rows = await prisma.$queryRaw<
      Array<{
        filing_year: number;
        filing_period: string | null;
        lobbying_activities: unknown;
      }>
    >`
      WITH ranked AS (
        SELECT
          filing_year,
          filing_period,
          lobbying_activities,
          filing_year * 10 + CASE filing_period
            WHEN 'first_quarter'  THEN 1
            WHEN 'second_quarter' THEN 2
            WHEN 'third_quarter'  THEN 3
            WHEN 'fourth_quarter' THEN 4
            WHEN 'mid_year'       THEN 2
            WHEN 'year_end'       THEN 4
            ELSE 0 END AS quarter_ord
        FROM lda_filing
        WHERE filing_period IS NOT NULL
      ),
      window AS (
        SELECT DISTINCT quarter_ord FROM ranked WHERE quarter_ord > 0
        ORDER BY quarter_ord DESC LIMIT 5
      )
      SELECT r.filing_year, r.filing_period, r.lobbying_activities
      FROM ranked r
      JOIN window w ON w.quarter_ord = r.quarter_ord
    `;

    console.log(`[lobby-trending-sync] tokenizing ${rows.length} filings`);

    const buckets = new Map<number, QuarterBucket>();
    for (const row of rows) {
      const quarter = PERIOD_TO_QUARTER[row.filing_period ?? ''] ?? 0;
      if (quarter === 0) continue;
      const ord = row.filing_year * 10 + quarter;
      let bucket = buckets.get(ord);
      if (!bucket) {
        bucket = {
          ord,
          year: row.filing_year,
          period: row.filing_period ?? '',
          counts: new Map(),
        };
        buckets.set(ord, bucket);
      }
      for (const desc of descriptionsFromActivities(row.lobbying_activities)) {
        for (const w of extractWords(desc)) {
          bucket.counts.set(w, (bucket.counts.get(w) ?? 0) + 1);
        }
      }
    }

    const sortedBuckets = [...buckets.values()].sort((a, b) => b.ord - a.ord);
    if (sortedBuckets.length === 0) {
      console.log('[lobby-trending-sync] no filing periods found, nothing to write');
      return;
    }

    const latest = sortedBuckets[0];
    const prior = sortedBuckets.slice(1, 5);

    if (!latest) {
      console.log('[lobby-trending-sync] empty latest bucket, nothing to write');
      return;
    }

    // Build a union of words across latest + prior buckets.
    const wordSet = new Set<string>(latest.counts.keys());
    for (const p of prior) {
      for (const w of p.counts.keys()) wordSet.add(w);
    }

    interface Scored {
      word: string;
      latestCount: number;
      avgPrior: number;
      growthPct: number;
    }

    const scored: Scored[] = [];
    for (const word of wordSet) {
      const latestCount = latest.counts.get(word) ?? 0;
      if (latestCount < 3) continue; // noise floor
      const priorTotal = prior.reduce((sum, p) => sum + (p.counts.get(word) ?? 0), 0);
      const avgPrior = prior.length > 0 ? priorTotal / prior.length : 0;
      const growthPct = ((latestCount - avgPrior) / Math.max(avgPrior, 1)) * 100;
      scored.push({ word, latestCount, avgPrior, growthPct });
    }

    const trending = scored
      .filter((s) => s.growthPct > 0)
      .sort((a, b) => b.growthPct - a.growthPct)
      .slice(0, 200);

    const top = scored
      .slice()
      .sort((a, b) => b.latestCount - a.latestCount)
      .slice(0, 100);

    // Wipe existing topics + re-insert (small dataset, simpler than diff).
    await prisma.lobbyTrendingTopic.deleteMany({});

    const trendingRows = trending.map((w) => ({
      id: randomUUID(),
      word: w.word,
      latestCount: w.latestCount,
      avgPrior: w.avgPrior,
      growthPct: w.growthPct,
      kind: 'trending' as const,
    }));

    const seenWords = new Set(trendingRows.map((r) => r.word));
    const topRows = top
      .filter((w) => !seenWords.has(w.word))
      .map((w) => ({
        id: randomUUID(),
        word: w.word,
        latestCount: w.latestCount,
        avgPrior: null as number | null,
        growthPct: null as number | null,
        kind: 'top' as const,
      }));

    const allRows = [...trendingRows, ...topRows];
    if (allRows.length > 0) {
      await prisma.lobbyTrendingTopic.createMany({ data: allRows });
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[lobby-trending-sync] DONE in ${elapsed}s — ` +
        `latest=${latest.year}/${latest.period}, prior_quarters=${prior.length}, ` +
        `trending=${trendingRows.length}, top=${topRows.length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[lobby-trending-sync] FAILED', err);
  process.exit(1);
});
