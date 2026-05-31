/**
 * Step 24 — NDAA conference report PE-mark loader (final negotiated authorization).
 *
 *   pnpm --filter @capiro/api parse:ndaa-conference -- --artifact scripts/__data__/ndaa_conference_fy2027.json
 *
 * Reads a committed rows artifact (offline pdfplumber extraction) and writes each
 * PE's conference mark to ProgramElementYear.conference via the program-element
 * writer under source 'conference_report_fy<NN>'. The writer validates pe_codes
 * (quarantining bad ones), applies source priority, and emits IntelligenceChange
 * on deltas. Idempotent. Same pattern as Steps 22/23.
 */
import { config as dotenvConfig } from 'dotenv';
import * as fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ProgramElementWriterService } from '../src/program-element/program-element-writer.service.js';
import {
  ConferenceReportParserService,
  parseExtractedRows,
} from '../src/program-element/parsers/conference-report-parser.service.js';
import type { ExtractedReportRow } from '../src/program-element/parsers/committee-report-parser.js';

dotenvConfig();

interface Artifact {
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
    console.error('Usage: parse-ndaa-conference.ts --artifact <rows.json> [--fy 2027]');
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as Artifact;
  const fy = Number(arg('fy') ?? artifact.fy);
  if (!Number.isFinite(fy)) {
    console.error('Missing/invalid --fy (and none in artifact)');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  await prisma.$connect();
  try {
    const writer = new ProgramElementWriterService(prisma as unknown as PrismaService);
    const parser = new ConferenceReportParserService(writer);
    const records = parseExtractedRows(artifact.rows ?? [], { fy });
    const result = await parser.load(records, 'conference', fy);
    console.log(JSON.stringify({ artifact: artifactPath, ...result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
