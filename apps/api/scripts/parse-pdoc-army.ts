/**
 * Step 27 — P-Doc (Procurement) PE-mark loader (all Services, parameterized).
 *
 *   pnpm --filter @capiro/api parse:pdoc -- --service ARMY --artifact scripts/__data__/pdoc_army_aircraft_fy2027.json
 *
 * Reads a committed rows artifact (offline pdfplumber extraction, extract_pdoc.py)
 * and loads parent procurement PEs + child line items via PDocParserService:
 *   - parent PE  → program_element (appropriationType='PROC') + program_element_year
 *   - child rows → program_element_procurement_line (hierarchy by pe_code)
 * under source 'p_doc_<service>_fy<NN>'. The writer validates pe_codes
 * (quarantining bad ones), applies source priority, and emits IntelligenceChange
 * on deltas. Idempotent. Deterministic — no Firecrawl/LLM at runtime.
 */
import { config as dotenvConfig } from 'dotenv';
import * as fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ProgramElementWriterService } from '../src/program-element/program-element-writer.service.js';
import {
  PDocParserService,
  parseProcurementPes,
  type ExtractedProcurementPe,
  type ProcurementService,
} from '../src/program-element/parsers/pdoc/pdoc-parser.service.js';

dotenvConfig();

const SERVICES: ProcurementService[] = ['ARMY', 'NAVY', 'AF', 'SF', 'USMC', 'DW', 'DARPA'];

interface Artifact {
  service?: string;
  fy?: number;
  sourceUrl?: string;
  pes?: ExtractedProcurementPe[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const artifactPath = arg('artifact');
  if (!artifactPath) {
    console.error('Usage: parse-pdoc.ts --artifact <rows.json> [--service ARMY] [--fy 2027]');
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as Artifact;
  const service = (arg('service') ?? artifact.service ?? '').toUpperCase() as ProcurementService;
  const fy = Number(arg('fy') ?? artifact.fy);
  if (!SERVICES.includes(service)) {
    console.error(`Invalid --service: ${service} (expected one of ${SERVICES.join(', ')})`);
    process.exit(1);
  }
  if (!Number.isFinite(fy)) {
    console.error('Missing/invalid --fy (and none in artifact)');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  await prisma.$connect();
  try {
    const prismaService = prisma as unknown as PrismaService;
    const writer = new ProgramElementWriterService(prismaService);
    const parser = new PDocParserService(writer, prismaService);

    const records = parseProcurementPes(artifact.pes ?? [], { fy, service });
    const result = await parser.load(records, service, fy, artifact.sourceUrl);

    console.log(JSON.stringify({ artifact: artifactPath, ...result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
