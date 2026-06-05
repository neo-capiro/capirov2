/**
 * reconcile-personnel-supersede.ts
 *
 *   tsx scripts/reconcile-personnel-supersede.ts            # DRY RUN (counts + samples)
 *   tsx scripts/reconcile-personnel-supersede.ts --commit   # set superseded_at
 *   flags: --limit=N (cap supersedes this run; 0 = all)
 *
 * Soft-supersedes acquisition-personnel whose ENTIRE provenance is the old DoW
 * spreadsheet (stanford_dow_directory_jan2026 / stanford_dow_tier1) and who are
 * absent from the updated directory (dow_directory_rev6_2026_06). Conservative:
 * anyone with a current/other source mention — the new directory, a congressional
 * roster, press/SAM/hearing/GAO ingest, a confirmed PE match — is kept (see
 * classifyPersonStaleness). Reversible: clears with `superseded_at = NULL`.
 *
 * Does NOT emit person_departed events — this is a data-supersede of a bad load,
 * not a real-world departure. Idempotent: re-running supersedes nothing new.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  classifyPersonStaleness,
  isTier1,
} from '../src/acquisition-personnel/staleness/personnel-staleness.js';

dotenvConfig();

const COMMIT = process.argv.includes('--commit');

function numArg(name: string, def: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return def;
  const v = Number(hit.split('=')[1]);
  return Number.isFinite(v) ? v : def;
}

const SUPERSEDE_REASON =
  'old DoW-directory spreadsheet only (stanford_dow_*); absent from dow_directory_rev6_2026_06';

async function main(): Promise<void> {
  const limit = numArg('limit', 0);
  const prisma = new PrismaClient();
  await prisma.$connect();
  try {
    const people = await prisma.acquisitionPersonnel.findMany({
      where: { supersededAt: null },
      select: {
        id: true,
        fullName: true,
        pePrimary: true,
        peSecondary: true,
        sources: { select: { source: true } },
      },
    });

    const toSupersede: typeof people = [];
    let tier1 = 0;
    let linkedToPe = 0;
    for (const p of people) {
      const decision = classifyPersonStaleness({ supersededAt: null, sources: p.sources });
      if (decision.action === 'supersede') {
        toSupersede.push(p);
        if (isTier1(p.sources)) tier1 += 1;
        if (p.pePrimary || (p.peSecondary?.length ?? 0) > 0) linkedToPe += 1;
      }
    }

    const capped = limit > 0 ? toSupersede.slice(0, limit) : toSupersede;

    let superseded = 0;
    if (COMMIT && capped.length > 0) {
      const now = new Date();
      const BATCH = 500;
      for (let i = 0; i < capped.length; i += BATCH) {
        const ids = capped.slice(i, i + BATCH).map((p) => p.id);
        const res = await prisma.acquisitionPersonnel.updateMany({
          where: { id: { in: ids }, supersededAt: null },
          data: { supersededAt: now, supersededReason: SUPERSEDE_REASON },
        });
        superseded += res.count;
      }
    }

    console.log(
      JSON.stringify(
        {
          mode: COMMIT ? 'COMMIT' : 'DRY_RUN',
          scanned: people.length,
          wouldSupersede: toSupersede.length,
          wouldSupersedeTier1: tier1,
          wouldSupersedeLinkedToPe: linkedToPe,
          capApplied: limit > 0 ? limit : null,
          superseded: COMMIT ? superseded : 0,
          sampleNames: capped.slice(0, 15).map((p) => p.fullName),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(
    '[reconcile-personnel-supersede] FAILED',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
