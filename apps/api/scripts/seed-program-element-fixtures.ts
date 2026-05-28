import { config as dotenvConfig } from 'dotenv';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ProgramElementWriterService } from '../src/program-element/program-element-writer.service.js';
import { type ProgramElementFixture, PROGRAM_ELEMENT_FIXTURES } from '../src/program-element/program-element-fixture-data.js';

dotenvConfig();

export interface ProgramElementWriterLike {
  upsertProgramElement(
    record: ProgramElementFixture['record'],
    source: string,
    sourceConfidence: number,
  ): Promise<{ inserted: boolean; pe_code: string }>;
  upsertProgramElementYear(
    record: ProgramElementFixture['years'][number],
    source: string,
  ): Promise<{ inserted: boolean; changed: boolean; delta?: Array<{ field: string; oldValue: unknown; newValue: unknown }> }>;
  upsertProgramElementMilestone(
    record: ProgramElementFixture['milestones'][number],
    source: string,
  ): Promise<{ inserted: boolean }>;
}

export interface SeedSummary {
  peInserted: number;
  yearInserted: number;
  yearChanged: number;
  milestoneInserted: number;
}

export async function seedProgramElementFixtures(writer: ProgramElementWriterLike): Promise<SeedSummary> {
  const summary: SeedSummary = {
    peInserted: 0,
    yearInserted: 0,
    yearChanged: 0,
    milestoneInserted: 0,
  };

  for (const fixture of PROGRAM_ELEMENT_FIXTURES) {
    const peResult = await writer.upsertProgramElement(fixture.record, 'fixture', 0.99);
    if (peResult.inserted) summary.peInserted += 1;

    for (const yearRecord of fixture.years) {
      const yearResult = await writer.upsertProgramElementYear(yearRecord, 'fixture');
      if (yearResult.inserted) summary.yearInserted += 1;
      if (yearResult.changed) summary.yearChanged += 1;
    }

    for (const milestoneRecord of fixture.milestones) {
      const milestoneResult = await writer.upsertProgramElementMilestone(milestoneRecord, 'fixture');
      if (milestoneResult.inserted) summary.milestoneInserted += 1;
    }
  }

  return summary;
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.onModuleInit();

  try {
    const writer = new ProgramElementWriterService(prisma);
    const summary = await seedProgramElementFixtures(writer);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ fixtures: PROGRAM_ELEMENT_FIXTURES.length, ...summary }, null, 2));
  } finally {
    await prisma.onModuleDestroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
