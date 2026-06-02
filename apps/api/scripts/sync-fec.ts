/**
 * Sync FEC campaign finance data (committees + top contributions).
 *   pnpm --filter @capiro/api sync:fec
 * Source: api.open.fec.gov/v1/
 * Auth: API key. Key in env: FEC_API_KEY
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { runWithSyncRun } from '../src/ingestion/sync-run.helper.js';
dotenvConfig();

const FEC_BASE = 'https://api.open.fec.gov/v1';
const FEC_KEY = process.env.FEC_API_KEY ?? '';
const DELAY_MS = 500;
const CYCLES = [2022, 2024, 2026];
// FEC /committees/ validates committee_type as a SINGLE value per request
// (comma-joined 'H,S,P' returns HTTP 422). Iterate each type with its own call.
const COMMITTEE_TYPES = ['H', 'S', 'P'];

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
  console.log('[fec-sync] starting');
  if (!FEC_KEY) throw new Error('FEC_API_KEY env var is required');

  try {
    await runWithSyncRun(prisma as any, 'sync-fec', async () => {
      const t0 = Date.now();
      // Fetch top committees by receipts for each cycle
      let totalComms = 0;
    for (const cycle of CYCLES) {
    for (const ctype of COMMITTEE_TYPES) {
    for (let page = 1; page <= 10; page++) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const data = await fetchFec<{ results: any[] }>('/committees/', {
        cycle: String(cycle), page: String(page),
        committee_type: ctype, // single value — FEC rejects comma-joined lists (422)
        // NOTE: FEC /committees/ rejects sort=-receipts ("Cannot sort on receipts
        // when parameter 'q' is not set", 422). Default ordering is fine.
      });
      if (!data?.results?.length) break;

      for (const c of data.results) {
        await (prisma as any).fecCommittee.upsert({
          where: { id: c.committee_id },
          update: {
            name: c.name, designation: c.designation || null,
            committeeType: c.committee_type || null, party: c.party || null,
            state: c.state || null, treasurerName: c.treasurer_name || null,
            totalReceipts: c.receipts ?? null, totalDisbursements: c.disbursements ?? null,
            cashOnHand: c.last_cash_on_hand_end_period ?? null,
            cycles: { set: Array.from(new Set([...(c.cycles ?? []), cycle])) },
            lastSyncedAt: new Date(),
          },
          create: {
            id: c.committee_id, name: c.name, designation: c.designation || null,
            committeeType: c.committee_type || null, party: c.party || null,
            state: c.state || null, treasurerName: c.treasurer_name || null,
            totalReceipts: c.receipts ?? null, totalDisbursements: c.disbursements ?? null,
            cashOnHand: c.last_cash_on_hand_end_period ?? null,
            cycles: Array.from(new Set([...(c.cycles ?? []), cycle])),
          },
        });
        totalComms++;
      }
      console.log(`[fec-sync] committees page ${page} cycle ${cycle} type ${ctype}: ${data.results.length}`);
    }
    } // end committee-type loop
    } // end cycles loop

    // Fetch recent individual contributions (top by amount) across cycles
    let totalContribs = 0;
    for (const cycle of CYCLES) {
    for (let page = 1; page <= 5; page++) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const data = await fetchFec<{ results: any[] }>('/schedules/schedule_a/', {
        two_year_transaction_period: String(cycle), sort: '-contribution_receipt_amount',
        min_amount: '10000', page: String(page),
      });
      if (!data?.results?.length) break;

      for (const c of data.results) {
        if (!c.contribution_receipt_amount) continue;

        const contributionDate = c.contribution_receipt_date ? new Date(c.contribution_receipt_date) : null;
        const safeContributionDate = contributionDate && !Number.isNaN(contributionDate.getTime()) ? contributionDate : null;

        try {
          await (prisma as any).fecContribution.create({
            data: {
              committeeId: c.committee_id || '',
              committeeName: c.committee?.name || c.committee_name || null,
              candidateId: c.candidate_id || c.candidate?.candidate_id || null,
              candidateName: c.candidate_name || c.candidate?.name || null,
              contributorName: c.contributor_name || 'Unknown',
              contributorEmployer: c.contributor_employer || null,
              contributorOccupation: c.contributor_occupation || null,
              amount: c.contribution_receipt_amount,
              contributionDate: safeContributionDate,
              receiptType: c.receipt_type || null,
              memoText: c.memo_text || null,
              state: c.contributor_state || c.committee?.state || null,
              cycle,
            },
          });
          totalContribs++;
        } catch (err: any) {
          // P2002 = unique constraint hit (expected for re-runs); keep quiet.
          if (err?.code !== 'P2002') {
            console.warn(`[fec-sync] contribution insert failed: ${err?.message ?? String(err)}`);
          }
        }
      }
      console.log(`[fec-sync] contributions page ${page} cycle ${cycle}: ${data.results.length}`);
    }
    } // end contributions cycles loop

    console.log(`[fec-sync] total: ${totalComms} committees, ${totalContribs} contributions`);
    console.log(`[fec-sync] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return { inserted: totalContribs, updated: totalComms, skipped: 0, errors: 0 };
    });
  } finally { await prisma.$disconnect(); }
}

main().catch((err) => { console.error('[fec-sync] FAILED', err); process.exit(1); });