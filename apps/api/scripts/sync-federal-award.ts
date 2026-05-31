/**
 * Step 28 — federal_award sync from USAspending.gov, enriched with PE attribution.
 *
 *   pnpm --filter @capiro/api sync:federal-award                 # daily: DoD, last 7 days
 *   tsx scripts/sync-federal-award.ts --days 7
 *   tsx scripts/sync-federal-award.ts --backfill --since 2020-10-01   # separate backfill
 *
 * USAspending API v2 (api.usaspending.gov/api/v2/search/spending_by_award), filtered
 * to DoD awarding agency, delta on action_date. Cursor (page)-based pagination. For
 * each award: resolve a PE code (explicit field, else regex on description), validate
 * against program_element (keep only known PEs; otherwise pe_code stays NULL — NOT
 * quarantined), and upsert by generated_unique_award_id. SyncRun row tracks the run.
 *
 * Idempotent: upsert keyed on award_unique_id; re-running the same window changes
 * nothing. Deterministic PE extraction.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { AwardPeExtractorService } from '../src/program-element/extractors/award-pe-extractor.service.js';

dotenvConfig();

const USASPENDING = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const DOD_TOPTIER = '097'; // Department of Defense toptier agency code

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  return d.toISOString().slice(0, 10);
}

interface AwardResult {
  generatedInternalId: string;
  piid: string | null;
  fain: string | null;
  recipientName: string | null;
  recipientUei: string | null;
  amount: number | null;
  description: string | null;
  awardingAgency: string | null;
  awardingSubTier: string | null;
  actionDate: string | null;
}

/** Fetch one page of DoD awards in [startDate, endDate] (action_date). */
async function fetchPage(startDate: string, endDate: string, page: number): Promise<{ results: AwardResult[]; hasNext: boolean }> {
  const body = {
    filters: {
      time_period: [{ start_date: startDate, end_date: endDate, date_type: 'action_date' }],
      agencies: [{ type: 'awarding', tier: 'toptier', toptier_code: DOD_TOPTIER }],
      award_type_codes: ['A', 'B', 'C', 'D'], // contract award types
    },
    fields: [
      'Award ID', 'Recipient Name', 'Recipient UEI', 'Award Amount',
      'Description', 'Awarding Agency', 'Awarding Sub Agency', 'Action Date', 'generated_internal_id',
    ],
    page,
    limit: 100,
    sort: 'Award Amount',
    order: 'desc',
  };
  const res = await fetch(USASPENDING, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`USAspending ${res.status}: ${await res.text().catch(() => '')}`);
  const json = (await res.json()) as { results?: Record<string, unknown>[]; page_metadata?: { hasNext?: boolean } };
  const results: AwardResult[] = (json.results ?? []).map((r) => ({
    generatedInternalId: String(r.generated_internal_id ?? r['generated_internal_id'] ?? ''),
    piid: (r['Award ID'] as string) ?? null,
    fain: null,
    recipientName: (r['Recipient Name'] as string) ?? null,
    recipientUei: (r['Recipient UEI'] as string) ?? null,
    amount: r['Award Amount'] != null ? Number(r['Award Amount']) : null,
    description: (r['Description'] as string) ?? null,
    awardingAgency: (r['Awarding Agency'] as string) ?? null,
    awardingSubTier: (r['Awarding Sub Agency'] as string) ?? null,
    actionDate: (r['Action Date'] as string) ?? null,
  }));
  return { results, hasNext: Boolean(json.page_metadata?.hasNext) };
}

async function main(): Promise<void> {
  const backfill = hasFlag('backfill');
  const endDate = isoDaysAgo(0);
  const startDate = backfill ? (arg('since') ?? '2020-10-01') : isoDaysAgo(Number(arg('days') ?? 7));
  const source = 'usaspending_federal_award';

  const prisma = new PrismaClient();
  await prisma.$connect();
  const extractor = new AwardPeExtractorService();

  const run = await prisma.syncRun.create({
    data: { source, startedAt: new Date(), status: 'running' },
  });

  let inserted = 0;
  let updated = 0;
  let errors = 0;
  let withPe = 0;

  try {
    // Load known PE codes once (validation set).
    const pes = await prisma.programElement.findMany({ select: { peCode: true } });
    const knownPeCodes = new Set(pes.map((p) => p.peCode.toUpperCase()));
    console.error(`Loaded ${knownPeCodes.size} known PE codes; window ${startDate}..${endDate}`);

    let page = 1;
    const maxPages = backfill ? 1000 : 200; // circuit breaker
    for (; page <= maxPages; page += 1) {
      const { results, hasNext } = await fetchPage(startDate, endDate, page);
      for (const a of results) {
        if (!a.generatedInternalId) {
          errors += 1;
          continue;
        }
        const peCode = extractor.extractPeCode(
          { description: a.description },
          knownPeCodes,
        );
        if (peCode) withPe += 1;

        const data = {
          awardUniqueId: a.generatedInternalId,
          piid: a.piid,
          fain: a.fain,
          awardingAgency: a.awardingAgency,
          awardingSubTier: a.awardingSubTier,
          contractorName: a.recipientName,
          recipientUei: a.recipientUei,
          amount: a.amount,
          description: a.description,
          peCode,
          actionDate: a.actionDate ? new Date(a.actionDate) : null,
          awardedAt: a.actionDate ? new Date(a.actionDate) : null,
          raw: a as object,
          lastSyncedAt: new Date(),
        };

        const existing = await prisma.federalAward.findUnique({
          where: { awardUniqueId: a.generatedInternalId },
          select: { id: true },
        });
        await prisma.federalAward.upsert({
          where: { awardUniqueId: a.generatedInternalId },
          create: data,
          update: data,
        });
        if (existing) updated += 1;
        else inserted += 1;
      }
      if (!hasNext || results.length === 0) break;
    }

    await prisma.syncRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: 'success', rowsInserted: inserted, rowsUpdated: updated, errorCount: errors },
    });
    console.log(JSON.stringify({ source, window: { startDate, endDate }, inserted, updated, withPe, errors }, null, 2));
  } catch (err) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), status: 'error', rowsInserted: inserted, rowsUpdated: updated, errorCount: errors + 1, errorMessage: String(err) },
    });
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
