/**
 * Step 22 — HASC / SASC committee-report PE-mark loader.
 *
 *   pnpm --filter @capiro/api parse:hasc-report -- --artifact scripts/__data__/armed_services_hasc_fy2027.json
 *   pnpm --filter @capiro/api parse:sasc-report -- --artifact scripts/__data__/armed_services_sasc_fy2027.json
 *
 * Reads a committed rows artifact produced by the offline pdfplumber extractor
 * (scripts/__tools__/extract_armed_services_report.py) and loads the per-PE
 * committee marks through the program-element writer, which validates pe_codes
 * (quarantining bad ones), applies source priority, and emits IntelligenceChange
 * on deltas. Idempotent: re-running the same artifact yields no new deltas.
 *
 * Consistent with the R-1/R-2 J-book loaders — no Textract/LLM at runtime.
 */
import { config as dotenvConfig } from 'dotenv';
import * as fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ProgramElementWriterService } from '../src/program-element/program-element-writer.service.js';
import {
  ArmedServicesReportParserService,
  parseExtractedRows,
  type Chamber,
  type ExtractedReportRow,
} from '../src/program-element/parsers/armed-services-report-parser.service.js';

dotenvConfig();

interface Artifact {
  chamber?: string;
  fy?: number;
  rows?: ExtractedReportRow[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const artifactPath = arg('artifact');
  if (!artifactPath) {
    console.error('Usage: parse-hasc-sasc-reports.ts --artifact <rows.json> [--chamber HASC|SASC] [--fy 2027]');
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as Artifact;
  const chamber = ((arg('chamber') ?? artifact.chamber ?? 'HASC').toUpperCase() as Chamber);
  const fy = Number(arg('fy') ?? artifact.fy);
  if (chamber !== 'HASC' && chamber !== 'SASC') {
    console.error(`Invalid chamber: ${chamber} (expected HASC or SASC)`);
    process.exit(1);
  }
  if (!Number.isFinite(fy)) {
    console.error('Missing/invalid --fy (and none in artifact)');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  await prisma.$connect();
  try {
    const writer = new ProgramElementWriterService(prisma as unknown as PrismaService);
    const parser = new ArmedServicesReportParserService(writer);

    const records = parseExtractedRows(artifact.rows ?? [], { fy });
    const result = await parser.load(records, chamber, fy);

    console.log(JSON.stringify({ artifact: artifactPath, ...result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
