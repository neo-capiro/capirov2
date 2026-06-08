/**
 * Reconciliation queue unit-artifact triage (Step 0.2 maintenance).
 *
 * The PE budget model is canonical in $ MILLIONS. Every loader normalizes to
 * millions at the boundary (dollarsToMillions / thousandsToMillions). The
 * reconciliation queue stores BOTH the canonical value and the conflicting
 * source's value verbatim, so if a source ever reached the writer in RAW units
 * (full dollars / thousands) — e.g. rows queued before the 2026-06-05 unit fix,
 * or a source that skipped normalization — the queue shows the SAME figure with
 * a ~1,000x or ~1,000,000x gap. Those are false conflicts ("canonical missing
 * 0s"), not real source disagreements: the canonical (millions) is correct.
 *
 * This script is READ-ONLY by default: it reports the open queue grouped by
 * conflicting source + field, classifying each row as a unit artifact (>=100x
 * gap, either direction) or a genuine disagreement (<100x). Real budget
 * disagreements are well under 100x, so the threshold never touches them.
 *
 *   tsx scripts/diag-reconciliation-units.ts                 # report only
 *   tsx scripts/diag-reconciliation-units.ts --source hac_d  # filter a source
 *   tsx scripts/diag-reconciliation-units.ts --commit        # resolve artifacts
 *
 * --commit resolves ONLY the unit-artifact rows as keep_current (mark reviewed,
 * NO value change — the canonical is already correct). Genuine disagreements are
 * never touched. Idempotent.
 */
import { PrismaClient } from '@prisma/client';

const UNIT_RATIO = 100; // >=100x gap (either direction) = unit mismatch, not a real disagreement.

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Row = {
  id: string;
  peCode: string;
  fy: number;
  fieldName: string;
  currentValue: string | null;
  conflictingSource: string;
  conflictingValue: string | null;
  deltaPct: number | null;
};

type Verdict = 'unit_artifact' | 'genuine' | 'unparseable';

function classify(row: Row): { verdict: Verdict; ratio: number | null } {
  const canon = row.currentValue === null ? NaN : Number(row.currentValue);
  const conf = row.conflictingValue === null ? NaN : Number(row.conflictingValue);
  if (!Number.isFinite(canon) || !Number.isFinite(conf)) return { verdict: 'unparseable', ratio: null };
  if (canon === 0 || conf === 0) return { verdict: 'genuine', ratio: null };
  const ratio = Math.abs(conf / canon);
  if (ratio >= UNIT_RATIO || ratio <= 1 / UNIT_RATIO) return { verdict: 'unit_artifact', ratio };
  return { verdict: 'genuine', ratio };
}

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');
  const sourceFilter = argValue('source');
  const prisma = new PrismaClient();
  await prisma.$connect();
  try {
    const rows = (await prisma.reconciliationReviewQueue.findMany({
      where: { status: 'open', ...(sourceFilter ? { conflictingSource: sourceFilter } : {}) },
      select: {
        id: true, peCode: true, fy: true, fieldName: true,
        currentValue: true, conflictingSource: true, conflictingValue: true, deltaPct: true,
      },
      orderBy: [{ conflictingSource: 'asc' }, { fieldName: 'asc' }],
    })) as Row[];

    if (rows.length === 0) {
      console.log(`No OPEN reconciliation rows${sourceFilter ? ` for source=${sourceFilter}` : ''}.`);
      return;
    }

    // Group by source → field → verdict.
    type Bucket = { unit: Row[]; genuine: Row[]; unparseable: Row[] };
    const bySource = new Map<string, Bucket>();
    for (const r of rows) {
      const { verdict } = classify(r);
      const b = bySource.get(r.conflictingSource) ?? { unit: [], genuine: [], unparseable: [] };
      if (verdict === 'unit_artifact') b.unit.push(r);
      else if (verdict === 'genuine') b.genuine.push(r);
      else b.unparseable.push(r);
      bySource.set(r.conflictingSource, b);
    }

    console.log(`\n=== OPEN reconciliation queue: ${rows.length} row(s) ===\n`);
    let totalUnit = 0;
    for (const [source, b] of [...bySource.entries()].sort()) {
      totalUnit += b.unit.length;
      console.log(`SOURCE "${source}":  ${b.unit.length} unit-artifact · ${b.genuine.length} genuine · ${b.unparseable.length} unparseable`);
      const sample = b.unit[0] ?? b.genuine[0];
      if (sample) {
        const { ratio } = classify(sample);
        console.log(
          `    e.g. ${sample.peCode} FY${sample.fy} ${sample.fieldName}: ` +
            `canonical=${sample.currentValue} vs conflicting=${sample.conflictingValue}` +
            (ratio ? ` (~${ratio >= 1 ? Math.round(ratio) : (1 / ratio).toFixed(0)}x ${ratio >= 1 ? 'larger' : 'smaller'})` : ''),
        );
      }
    }
    console.log(`\nTotal unit-artifact rows (false conflicts): ${totalUnit} of ${rows.length}`);

    if (!commit) {
      console.log(`\nDRY RUN — pass --commit to resolve the ${totalUnit} unit-artifact row(s) as keep_current`);
      console.log(`(canonical is correct in $ millions; genuine disagreements are left untouched).`);
      return;
    }

    const ids = rows.filter((r) => classify(r).verdict === 'unit_artifact').map((r) => r.id);
    if (ids.length === 0) {
      console.log('\nNothing to resolve.');
      return;
    }
    const res = await prisma.reconciliationReviewQueue.updateMany({
      where: { id: { in: ids }, status: 'open' },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolutionNotes:
          'auto-resolved (diag-reconciliation-units): unit-mismatch artifact — conflicting value in raw $ vs canonical $M; kept canonical (no value change).',
      },
    });
    console.log(`\nResolved ${res.count} unit-artifact row(s) as keep_current.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
