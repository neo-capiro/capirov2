/**
 * report-award-pe-coverage.ts — READ-ONLY diagnostic.
 *
 *   tsx scripts/report-award-pe-coverage.ts
 *
 * Prints federal_award PE/acquisition-program coverage as JSON so we can state
 * the contractor-panel coverage HONESTLY without direct Aurora access (the API
 * container entrypoint rejects ad-hoc SQL, so this verb is the supported way to
 * query live). Writes nothing.
 *
 * Output: total awards, how many carry a DoD acquisition program code, how many
 * have a resolved pe_code (broken down by pe_code_source), how many distinct PEs
 * are reachable through the curated acq-program map, and the top program codes by
 * award count among awards still lacking a PE (so we know which programs to add
 * to the map next for the biggest coverage win).
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient, Prisma } from '@prisma/client';

dotenvConfig();

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  await prisma.$connect();
  try {
    const [total, withAcqCode, withPe] = await Promise.all([
      prisma.federalAward.count(),
      prisma.federalAward.count({ where: { dodAcqProgramCode: { not: null } } }),
      prisma.federalAward.count({ where: { peCode: { not: null } } }),
    ]);

    const bySource = await prisma.$queryRaw<Array<{ source: string | null; n: number }>>(Prisma.sql`
      SELECT pe_code_source AS source, COUNT(*)::int AS n
      FROM federal_award
      WHERE pe_code IS NOT NULL
      GROUP BY pe_code_source
      ORDER BY n DESC
    `);

    const mapEntries = await prisma.programElementAcquisitionProgram.count();
    const distinctMappedPes = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT pe_code)::int AS n FROM program_element_acquisition_program
    `);

    // Top program codes among awards that have an acq code but NO resolved PE —
    // these are the highest-leverage additions to the curated map.
    const unmappedTopPrograms = await prisma.$queryRaw<
      Array<{ code: string; name: string | null; awards: number }>
    >(Prisma.sql`
      SELECT
        fa.dod_acq_program_code AS code,
        MAX(fa.dod_acq_program_name) AS name,
        COUNT(*)::int AS awards
      FROM federal_award fa
      LEFT JOIN program_element_acquisition_program m
        ON m.acq_program_code = fa.dod_acq_program_code
      WHERE fa.dod_acq_program_code IS NOT NULL
        AND fa.dod_acq_program_code NOT IN ('000', 'NONE', '')
        AND m.acq_program_code IS NULL
      GROUP BY fa.dod_acq_program_code
      ORDER BY awards DESC
      LIMIT 20
    `);

    console.log(
      JSON.stringify(
        {
          total,
          withAcqProgramCode: withAcqCode,
          withResolvedPeCode: withPe,
          peCodeBySource: bySource,
          curatedMapEntries: mapEntries,
          distinctMappedPeCodes: distinctMappedPes[0]?.n ?? 0,
          topUnmappedProgramsByAwardCount: unmappedTopPrograms,
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
  console.error('[report-award-pe-coverage] FAILED', err);
  process.exit(1);
});
