/**
 * Sync FEC PAC giving (Schedule B — disbursements BY a committee TO candidates).
 *   pnpm --filter @capiro/api sync:fec-pac
 * Source: api.open.fec.gov/v1/  ·  Auth: FEC_API_KEY
 *
 * This is the organization's OWN PAC giving — legally distinct from the individual
 * employer-linked contributions in fec_contribution (Schedule A). We only pull
 * committees that are linked to a client via a CONFIRMED
 * ClientIntelMapping(source='fec_committee'); never speculatively.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { runWithSyncRun } from '../src/ingestion/sync-run.helper.js';
dotenvConfig();

const FEC_BASE = 'https://api.open.fec.gov/v1';
const FEC_KEY = process.env.FEC_API_KEY ?? '';
const DELAY_MS = 500;
const CYCLES = [2022, 2024, 2026];
const MAX_PAGES = 10;

interface ScheduleBRow {
  committee_id?: string;
  committee_name?: string;
  recipient_name?: string;
  recipient_committee_id?: string;
  candidate_id?: string;
  candidate_name?: string;
  disbursement_amount?: number;
  disbursement_date?: string;
  disbursement_description?: string;
  disbursement_type?: string;
  memo_text?: string;
}

async function fetchFec<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const url = new URL(`${FEC_BASE}${path}`);
  url.searchParams.set('api_key', FEC_KEY);
  url.searchParams.set('per_page', '100');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`${resp.status}`);
    return (await resp.json()) as T;
  } catch (err) {
    console.warn(`GET ${path}: ${(err as Error).message}`);
    return null;
  }
}

async function main() {
  const prisma = new PrismaClient();
  console.log('[fec-pac-sync] starting');
  if (!FEC_KEY) throw new Error('FEC_API_KEY env var is required');

  try {
    await runWithSyncRun(prisma as any, 'sync-fec-pac', async () => {
    const t0 = Date.now();
    // Only sync committees that are CONFIRMED-linked to a client. external_id holds
    // the FEC committee_id (e.g. C00835926) for source='fec_committee' mappings.
    // client_intel_mapping is RLS-FORCED. This system sync enumerates confirmed
    // committee mappings ACROSS all tenants, so the read must bypass RLS.
    const mappings = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.bypass_rls = 'on'`);
      return tx.clientIntelMapping.findMany({
        where: { source: 'fec_committee', confirmed: true },
        select: { externalId: true, externalName: true },
      });
    });
    const committeeIds = Array.from(new Set(mappings.map((m) => m.externalId.trim()).filter(Boolean)));

    if (committeeIds.length === 0) {
      console.log('[fec-pac-sync] no confirmed fec_committee mappings — nothing to sync');
      return { inserted: 0, updated: 0, skipped: 0, errors: 0 };
    }
    console.log(`[fec-pac-sync] ${committeeIds.length} mapped committee(s): ${committeeIds.join(', ')}`);

    let totalRows = 0;
    for (const committeeId of committeeIds) {
      for (const cycle of CYCLES) {
        for (let page = 1; page <= MAX_PAGES; page++) {
          await new Promise((r) => setTimeout(r, DELAY_MS));
          const data = await fetchFec<{ results: ScheduleBRow[] }>('/schedules/schedule_b/', {
            committee_id: committeeId,
            two_year_transaction_period: String(cycle),
            sort: '-disbursement_amount',
            page: String(page),
          });
          if (!data?.results?.length) break;

          for (const r of data.results) {
            const amount = r.disbursement_amount;
            if (!amount || amount <= 0) continue;
            // Keep only candidate-directed disbursements (PAC -> candidate giving),
            // not operational spend; require a candidate or recipient committee.
            if (!r.candidate_name && !r.recipient_committee_id && !r.recipient_name) continue;

            const d = r.disbursement_date ? new Date(r.disbursement_date) : null;
            const disbursementDate = d && !Number.isNaN(d.getTime()) ? d : null;

            try {
              // Idempotent: dedup unique key (committee_id, recipient_name, amount, date, cycle).
              await prisma.fecPacContribution.upsert({
                where: {
                  // Composite unique — Prisma exposes it via the @@unique map name.
                  committeeId_recipientName_amount_disbursementDate_cycle: {
                    committeeId,
                    recipientName: r.recipient_name ?? '',
                    amount,
                    disbursementDate,
                    cycle,
                  },
                },
                update: { lastSyncedAt: new Date() },
                create: {
                  committeeId,
                  committeeName: r.committee_name ?? null,
                  recipientName: r.recipient_name ?? null,
                  recipientCommitteeId: r.recipient_committee_id ?? null,
                  candidateId: r.candidate_id ?? null,
                  candidateName: r.candidate_name ?? null,
                  amount,
                  disbursementDate,
                  disbursementType: r.disbursement_type ?? r.disbursement_description ?? null,
                  memoText: r.memo_text ?? null,
                  cycle,
                },
              });
              totalRows++;
            } catch (err: unknown) {
              const code = (err as { code?: string })?.code;
              if (code !== 'P2002') {
                console.warn(`[fec-pac-sync] upsert failed: ${(err as Error)?.message ?? String(err)}`);
              }
            }
          }
          console.log(`[fec-pac-sync] ${committeeId} cycle ${cycle} page ${page}: ${data.results.length}`);
        }
      }
    }

    console.log(`[fec-pac-sync] total: ${totalRows} PAC disbursements`);
    console.log(`[fec-pac-sync] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return { inserted: totalRows, updated: 0, skipped: 0, errors: 0 };
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[fec-pac-sync] FAILED', err);
  process.exit(1);
});
