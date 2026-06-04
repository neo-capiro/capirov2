/**
 * Read-only INGESTION HEALTH report. For each major synced table: total row
 * count + most-recent timestamp (so we can see staleness), plus the alert-gate
 * coverage. SAFE: COUNT() + findFirst(orderBy desc) reads only. No writes.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function maxDate(model: string, field: string): Promise<string | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ m: Date | null }>>(
      `SELECT MAX("${field}") AS m FROM "${model}"`,
    );
    const v = rows?.[0]?.m;
    return v ? new Date(v).toISOString().slice(0, 10) : null;
  } catch (e) {
    return `ERR:${e instanceof Error ? e.message.slice(0, 60) : 'x'}`;
  }
}

async function count(model: string): Promise<number | string> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
      `SELECT COUNT(*)::bigint AS c FROM "${model}"`,
    );
    return Number(rows?.[0]?.c ?? 0);
  } catch (e) {
    return `ERR:${e instanceof Error ? e.message.slice(0, 60) : 'x'}`;
  }
}

// table -> recency column (snake_case actual DB columns)
const TABLES: Array<[string, string]> = [
  ['congress_bill', 'updated_at'],
  ['federal_register_document', 'published_at'],
  ['lda_filing', 'dt_posted'],
  ['federal_award', 'awarded_at'],
  ['committee_hearing', 'date'],
  ['fec_contribution', 'contribution_date'],
  ['fara_registration', 'created_at'],
  ['sec_filing', 'filed_at'],
  ['gao_report', 'published_at'],
  ['crs_report', 'published_at'],
  ['regulation', 'updated_at'],
  ['rss_intel_item', 'published_at'],
  ['intelligence_change', 'detected_at'],
];

async function main(): Promise<void> {
  const out: Record<string, { rows: number | string; latest: string | null }> = {};
  for (const [t, col] of TABLES) {
    out[t] = { rows: await count(t), latest: await maxDate(t, col) };
  }
  console.log('INGEST_REPORT ' + JSON.stringify({ generatedAt: new Date().toISOString(), tables: out }, null, 2));
}

main()
  .catch((err) => {
    console.error('INGEST_ERR', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
