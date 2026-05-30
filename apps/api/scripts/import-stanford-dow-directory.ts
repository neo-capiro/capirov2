import { config as dotenvConfig } from 'dotenv';
import * as path from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AcquisitionPersonnelWriterService } from '../src/acquisition-personnel/acquisition-personnel-writer.service.js';
import { ProgramElementWriterService } from '../src/program-element/program-element-writer.service.js';

import { importStanfordDowDirectory } from '../src/acquisition-personnel/importers/stanford-dow-importer.js';

dotenvConfig();

async function main() {
  const workbookPath = path.resolve('scripts/__fixtures__/dow_directory_full.xlsx');

  const prisma = new PrismaService();
  await prisma.onModuleInit();

  const noOpMatcher = {
    findMatches: async () => [],
  };
  const writer = new AcquisitionPersonnelWriterService(prisma, noOpMatcher as never);
  const noOpPeMetrics = {
    emitCount: async () => undefined,
    emitSeconds: async () => undefined,
    emitGauge: async () => undefined,
  };
  const programElementWriter = new ProgramElementWriterService(prisma, noOpPeMetrics as never);

  try {
    const existingPersonByKey = new Map<string, string>();

    // Idempotency: pre-seed the dedup map from existing people (keyed by nameKey,
    // matching DB uniqueness) so re-runs add source mentions instead of creating
    // duplicate person rows.
    const loadExistingByNameKey = async (): Promise<Array<[string, string]>> => {
      const rows = await prisma.acquisitionPersonnel.findMany({ select: { id: true, nameKey: true } });
      return rows.map((r) => [r.nameKey, r.id] as [string, string]);
    };

    const first = await importStanfordDowDirectory(workbookPath, {
      writer,
      programElementWriter,
      existingPersonByKey,
      loadExistingByNameKey,
    });

    const second = await importStanfordDowDirectory(workbookPath, {
      writer,
      programElementWriter,
      existingPersonByKey,
      loadExistingByNameKey,
    });

    console.log(
      JSON.stringify(
        {
          first_run: first,
          second_run: second,
          rerun_zero_changes_check: {
            persons_inserted: second.persons_inserted === 0,
            persons_addSourceMentioned: second.persons_addSourceMentioned === 0,
            pes_inserted: second.pes_inserted === 0,
            pe_years_inserted: second.pe_years_inserted === 0,
          },
          spot_check_sample: first.spot_check_sample,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.onModuleDestroy();
  }
}

void main();
