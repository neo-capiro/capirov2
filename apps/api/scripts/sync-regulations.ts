/**
 * sync-regulations.ts, Fetch dockets from Regulations.gov API
 *
 * API docs: https://open.gsa.gov/api/regulationsgov/
 * Auth: API key via `api_key` query param
 * Rate limit: 1,000 requests/hour
 *
 * Usage:
 *   DATABASE_URL=... REGULATIONS_GOV_API_KEY=... tsx scripts/sync-regulations.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API_KEY = process.env.REGULATIONS_GOV_API_KEY;
const BASE_URL = 'https://api.regulations.gov/v4';
const PAGE_SIZE = 250;
const DELAY_MS = 400; // stay well under 1K/hr

if (!API_KEY) {
  console.error('[reg-sync] REGULATIONS_GOV_API_KEY not set');
  process.exit(1);
}

interface RegDocument {
  id: string;
  type: string;
  attributes: {
    agencyId: string;
    commentEndDate: string | null;
    commentStartDate: string | null;
    docketId: string;
    documentType: string; // Rule, Proposed Rule, Notice, Other
    frDocNum: string | null;
    lastModifiedDate: string;
    objectId: string;
    postedDate: string;
    subtype: string | null;
    title: string;
    withdrawn: boolean;
  };
}

interface RegResponse {
  data: RegDocument[];
  meta: { hasNextPage: boolean; totalElements: number };
}

async function fetchPage(pageNumber: number, postedAfter: string): Promise<RegResponse> {
  const params = new URLSearchParams({
    'api_key': API_KEY!,
    'filter[postedDate][ge]': postedAfter,
    'page[size]': String(PAGE_SIZE),
    'page[number]': String(pageNumber),
    'sort': '-postedDate',
  });

  const url = `${BASE_URL}/documents?${params}`;
  const res = await fetch(url);

  if (res.status === 429) {
    console.warn('[reg-sync] 429 rate limited, waiting 60s');
    await sleep(60_000);
    return fetchPage(pageNumber, postedAfter);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Regulations.gov API error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<RegResponse>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const start = Date.now();
  console.log('[reg-sync] Starting Regulations.gov sync...');

  // Incremental: max(posted_at) in DB becomes the floor. The full-history
  // pull from 2021 is the default for the first run; afterward, daily syncs
  // only fetch newly posted dockets. --incremental flag or env override.
  const incremental =
    process.argv.includes('--incremental') ||
    process.env.REG_SYNC_INCREMENTAL === '1';
  const sinceOverride = (() => {
    const i = process.argv.indexOf('--since');
    return i >= 0 ? process.argv[i + 1] : process.env.REG_SYNC_SINCE;
  })();
  let postedAfter = '2021-01-01';
  if (sinceOverride) {
    postedAfter = sinceOverride.slice(0, 10);
  } else if (incremental) {
    // Use the latest *non-future* postedDate as the incremental floor.
    // Regulations.gov occasionally returns dockets with a postedDate in the
    // future; taking a raw MAX(posted_date) lets one such row poison the
    // watermark and stall every subsequent sync (observed 2026-06: floor stuck
    // at 2026-12-13, fetching 1 doc/run). Ignoring future-dated rows keeps the
    // floor sane, and a 2-day overlap re-captures late edits near the boundary.
    const latest = await prisma.regulatoryDocket.findFirst({
      where: { postedDate: { lte: new Date() } },
      orderBy: { postedDate: 'desc' },
      select: { postedDate: true },
    });
    if (latest?.postedDate) {
      const floor = new Date(latest.postedDate);
      floor.setUTCDate(floor.getUTCDate() - 2);
      postedAfter = floor.toISOString().slice(0, 10);
    }
  }
  console.log(`[reg-sync] postedAfter=${postedAfter} (incremental=${incremental})`);
  let page = 1;
  let total = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await fetchPage(page, postedAfter);
    const docs = result.data;

    for (const doc of docs) {
      const attrs = doc.attributes;

      await prisma.$executeRawUnsafe(
        `INSERT INTO regulatory_docket (
          id, document_id, agency_id, docket_id, document_type, title,
          posted_date, comment_start_date, comment_end_date,
          fr_doc_num, subtype, withdrawn, last_modified, synced_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5,
          $6::timestamptz, $7::timestamptz, $8::timestamptz,
          $9, $10, $11, $12::timestamptz, NOW()
        )
        ON CONFLICT (document_id) DO UPDATE SET
          title = EXCLUDED.title,
          comment_end_date = EXCLUDED.comment_end_date,
          last_modified = EXCLUDED.last_modified,
          withdrawn = EXCLUDED.withdrawn,
          synced_at = NOW()`,
        doc.id,
        attrs.agencyId,
        attrs.docketId,
        attrs.documentType,
        attrs.title,
        attrs.postedDate ? new Date(attrs.postedDate) : null,
        attrs.commentStartDate ? new Date(attrs.commentStartDate) : null,
        attrs.commentEndDate ? new Date(attrs.commentEndDate) : null,
        attrs.frDocNum,
        attrs.subtype,
        attrs.withdrawn ?? false,
        attrs.lastModifiedDate ? new Date(attrs.lastModifiedDate) : null,
      );
      total++;
    }

    console.log(`[reg-sync] page ${page}: ${docs.length} docs (${total} total)`);

    hasMore = result.meta.hasNextPage && docs.length > 0;
    page++;
    await sleep(DELAY_MS);
  }

  const elapsed = ((Date.now() - start) / 60_000).toFixed(1);
  console.log(`[reg-sync] DONE in ${elapsed}m, ${total} documents synced`);
}

main()
  .catch((err) => {
    console.error('[reg-sync]', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
