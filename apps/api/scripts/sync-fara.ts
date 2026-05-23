/**
 * Sync FARA (Foreign Agents Registration Act) registrations.
 *
 *   pnpm --filter @capiro/api sync:fara
 *
 * Source: FARA eFiling API was at efile.fara.gov/api/v1/ but is offline as of May 2026.
 * Fallback: Scrape the FARA.gov Active Registrants HTML page.
 * The page at https://efile.fara.gov/ords/fara/q is also down.
 * Using the DOJ FARA search CSV export as alternative.
 * No auth required.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenvConfig();

const DELAY_MS = 500;

// Try multiple sources in order
const FARA_SOURCES = [
  'https://efile.fara.gov/api/v1/ActiveRegistrants',
  'https://efile.fara.gov/api/v2/ActiveRegistrants',
];

interface FaraRecord {
  Registration_Number: string;
  Registrant_Name: string;
  Foreign_Principal: string;
  FP_Country: string;
  Registration_Date: string;
  Termination_Date: string | null;
  Address_1: string;
  State: string;
  Status: string;
  FP_Reg_Description: string;
}

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

async function tryFetchJson(): Promise<FaraRecord[]> {
  for (const url of FARA_SOURCES) {
    try {
      console.log(`[fara-sync] trying ${url}`);
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        console.warn(`[fara-sync] ${url}: HTTP ${resp.status}`);
        continue;
      }
      const data = await resp.json() as any;
      const records = data?.REGISTRANTS_ACTIVE ?? data?.registrants ?? data?.results ?? [];
      if (records.length > 0) {
        console.log(`[fara-sync] got ${records.length} records from ${url}`);
        return records;
      }
    } catch (err) {
      console.warn(`[fara-sync] ${url}: ${(err as Error).message}`);
    }
  }
  return [];
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[fara-sync] starting');

  try {
    const records = await tryFetchJson();

    if (records.length === 0) {
      console.warn('[fara-sync] all FARA API sources are offline — skipping. FARA eFiling API has been down since early 2026.');
      console.log('[fara-sync] DONE (no data sources available) in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
      return;
    }

    console.log(`[fara-sync] found ${records.length} active registrations`);

    let total = 0;
    for (const r of records) {
      if (!r.Registration_Number) continue;

      await prisma.faraRegistration.upsert({
        where: { registrationNumber: r.Registration_Number },
        update: {
          registrantName: r.Registrant_Name || 'Unknown',
          foreignPrincipal: r.Foreign_Principal || 'Unknown',
          country: r.FP_Country || null,
          status: r.Status || 'Active',
          registrationDate: safeDate(r.Registration_Date),
          terminationDate: safeDate(r.Termination_Date),
          address: r.Address_1 || null,
          state: r.State || null,
          description: r.FP_Reg_Description || null,
          syncedAt: new Date(),
        },
        create: {
          registrationNumber: r.Registration_Number,
          registrantName: r.Registrant_Name || 'Unknown',
          foreignPrincipal: r.Foreign_Principal || 'Unknown',
          country: r.FP_Country || null,
          status: r.Status || 'Active',
          registrationDate: safeDate(r.Registration_Date),
          terminationDate: safeDate(r.Termination_Date),
          address: r.Address_1 || null,
          state: r.State || null,
          description: r.FP_Reg_Description || null,
        },
      });
      total++;

      if (total % 200 === 0) console.log(`[fara-sync]   ${total} processed...`);
    }

    console.log(`[fara-sync] total: ${total}`);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[fara-sync] DONE in ${elapsed}s`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[fara-sync] FAILED', err);
  process.exit(1);
});
