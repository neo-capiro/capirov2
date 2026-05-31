/**
 * Step 21 — Bill text PE-code extraction.
 *
 *   pnpm --filter @capiro/api extract:bill-pe-codes
 *   tsx scripts/extract-bill-pe-codes.ts [--no-full-text]
 *
 * Scans every CongressBill's text (title + latest action + cached/fetched full
 * text from GovInfo) for Program Element codes, filters to PEs that exist in
 * program_element, upserts the set onto the bill, and emits an IntelligenceChange
 * when the set changed and a newly-added PE is watched.
 *
 * Idempotent: a second run with no source changes performs no writes.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../src/config/config.schema.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { GovInfoService } from '../src/external/govinfo/govinfo.service.js';
import { BillPeExtractorService } from '../src/program-element/extractors/bill-pe-extractor.service.js';

dotenvConfig();

async function main(): Promise<void> {
  const fetchFullText = !process.argv.includes('--no-full-text');
  const prisma = new PrismaClient();
  await prisma.$connect();

  // Minimal ConfigService over process.env so GovInfoService can read its key +
  // bucket without bootstrapping the whole Nest AppModule.
  const config = {
    get: (k: keyof AppConfig) => process.env[k as string],
  } as unknown as ConfigService<AppConfig, true>;

  // The extractor service only calls prisma model delegates that PrismaClient
  // provides; reuse the live client as the PrismaService dependency.
  const prismaService = prisma as unknown as PrismaService;
  const govInfo = new GovInfoService(prismaService, config);
  const extractor = new BillPeExtractorService(prismaService, govInfo);

  const startedAt = Date.now();
  try {
    const results = await extractor.run({ fetchFullText });
    const changed = results.filter((r) => r.changed).length;
    const emitted = results.filter((r) => r.emitted).length;
    const withCodes = results.filter((r) => r.peCodes.length > 0).length;
    console.log(
      JSON.stringify(
        {
          bills_scanned: results.length,
          bills_with_pe_codes: withCodes,
          bills_changed: changed,
          intelligence_changes_emitted: emitted,
          full_text_fetch: fetchFullText,
          duration_seconds: Math.round((Date.now() - startedAt) / 1000),
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
  console.error(err);
  process.exit(1);
});
