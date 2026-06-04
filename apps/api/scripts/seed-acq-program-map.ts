/**
 * seed-acq-program-map.ts — curated DoD acquisition (MDAP) program -> Program
 * Element map. Idempotent upserts into program_element_acquisition_program.
 *
 *   tsx scripts/seed-acq-program-map.ts            # dry-run (reports, no writes)
 *   tsx scripts/seed-acq-program-map.ts --commit   # write
 *
 * This is the DEFENSIBLE bridge for the PE->contractor panel. USAspending stamps
 * every contract with a DoD acquisition program code (verified: 198=F-35,
 * 516=SSN 774, 387=KC-46A, ...). We map those codes to the Program Elements they
 * fund. The mapping is CURATED + REVIEWED here (not machine-inferred), so the
 * attribution shown to users is auditable.
 *
 * SAFETY: every (code -> peCode) pair is validated against program_element before
 * insert. PEs that don't exist in this deployment are SKIPPED and reported, never
 * invented. Codes that mean "no program" ('000'/'NONE') are rejected. Re-running
 * is safe (unique on (acq_program_code, pe_code); upsert).
 *
 * Extending the map: add entries to CURATED below (or grow it from
 * report-award-pe-coverage's topUnmappedProgramsByAwardCount). Keep peCodes to
 * real, citable program elements for that weapons system.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenvConfig();

interface CuratedEntry {
  code: string;
  name: string;
  /** Program Element codes this acquisition program funds (validated vs DB). */
  peCodes: string[];
}

// Curated seed. Codes are exactly as USAspending emits dod_acquisition_program.
// peCodes are canonical PEs for each system; only those present in this
// deployment's program_element table are inserted (others reported + skipped).
const CURATED: CuratedEntry[] = [
  { code: '198', name: 'F-35', peCodes: ['0604800F', '0604800N', '0207142F', '0207142N'] },
  { code: '516', name: 'SSN 774', peCodes: ['0604558N', '0204163N'] },
  { code: '387', name: 'KC-46A', peCodes: ['0605221F', '0207247F'] },
  { code: '334', name: 'P-8A', peCodes: ['0604407N', '0207236N'] },
  { code: '223', name: 'CVN 78', peCodes: ['0604567N', '0204220N'] },
  { code: '493', name: 'LGM-35A SENTINEL', peCodes: ['0604851F', '0101213F'] },
  { code: '265', name: 'F-22', peCodes: ['0207138F', '0604233F'] },
  { code: '200', name: 'C-17A', peCodes: ['0401130F'] },
  { code: '212', name: 'V-22', peCodes: ['0604262N', '0205456N'] },
  { code: '364', name: 'E-2D AHE', peCodes: ['0604234N', '0204114N'] },
  { code: '176', name: 'NSSL', peCodes: ['0603856F', '0305614F'] },
];

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const commit = hasFlag('commit');
  const prisma = new PrismaClient();
  await prisma.$connect();
  try {
    const pes = await prisma.programElement.findMany({ select: { peCode: true } });
    const known = new Set(pes.map((p) => p.peCode.toUpperCase()));

    let inserted = 0;
    let updated = 0;
    const skipped: Array<{ code: string; peCode: string }> = [];
    const wouldInsert: Array<{ code: string; peCode: string }> = [];

    for (const entry of CURATED) {
      const code = entry.code.trim().toUpperCase();
      if (!code || code === '000' || code === 'NONE') continue;
      for (const rawPe of entry.peCodes) {
        const peCode = rawPe.trim().toUpperCase();
        if (!known.has(peCode)) {
          skipped.push({ code, peCode });
          continue;
        }
        wouldInsert.push({ code, peCode });
        if (commit) {
          const existing = await prisma.programElementAcquisitionProgram.findUnique({
            where: { acqProgramCode_peCode: { acqProgramCode: code, peCode } },
            select: { id: true },
          });
          await prisma.programElementAcquisitionProgram.upsert({
            where: { acqProgramCode_peCode: { acqProgramCode: code, peCode } },
            create: {
              acqProgramCode: code,
              acqProgramName: entry.name,
              peCode,
              source: 'seed_curated_v1',
              confidence: 1.0,
            },
            update: { acqProgramName: entry.name, lastSyncedAt: new Date() },
          });
          if (existing) updated += 1;
          else inserted += 1;
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          mode: commit ? 'COMMIT' : 'DRY_RUN',
          curatedPrograms: CURATED.length,
          knownPeCount: known.size,
          inserted,
          updated,
          validPairs: wouldInsert.length,
          skippedUnknownPes: skipped,
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
  console.error('[seed-acq-program-map] FAILED', err);
  process.exit(1);
});
