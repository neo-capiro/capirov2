/**
 * Sync FARA (Foreign Agents Registration Act) registrations.
 *
 *   pnpm --filter @capiro/api sync:fara
 *
 * Source: efile.fara.gov/api/v1/
 * No auth required. Rate limits are generous.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenvConfig();

const FARA_BASE = 'https://efile.fara.gov/api/v1';
const DELAY_MS = 300;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const resp = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return (await resp.json()) as T;
  } catch (err) {
    console.warn(`GET ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

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

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[fara-sync] starting');

  try {
    // Fetch active registrations
    const activeUrl = `${FARA_BASE}/ActiveRegistrants`;
    const active = await fetchJson<{ REGISTRANTS_ACTIVE: FaraRecord[] }>(activeUrl);
    const records = active?.REGISTRANTS_ACTIVE ?? [];

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
