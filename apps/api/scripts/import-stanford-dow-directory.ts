import { config as dotenvConfig } from 'dotenv';
import * as path from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AcquisitionPersonnelWriterService } from '../src/acquisition-personnel/acquisition-personnel-writer.service.js';
import { MatchScorerService } from '../src/acquisition-personnel/matching/match-scorer.service.js';
import { ProgramElementWriterService } from '../src/program-element/program-element-writer.service.js';
import { ProgramElementMetricsService } from '../src/program-element/program-element-metrics.service.js';
import { importStanfordDowDirectory } from '../src/acquisition-personnel/importers/stanford-dow-importer.js';

dotenvConfig();

async function main() {
  const workbookPath = path.resolve('scripts/__fixtures__/dow_directory_full.xlsx');

  const prisma = new PrismaService();
  await prisma.onModuleInit();

  const matchScorer = new MatchScorerService(prisma);
  const writer = new AcquisitionPersonnelWriterService(prisma, matchScorer);
  const peMetrics = new ProgramElementMetricsService();
  const programElementWriter = new ProgramElementWriterService(prisma, peMetrics);

  try {
    const first = await importStanfordDowDirectory(workbookPath, {
      writer,
      programElementWriter,
    });

    const second = await importStanfordDowDirectory(workbookPath, {
      writer,
      programElementWriter,
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
