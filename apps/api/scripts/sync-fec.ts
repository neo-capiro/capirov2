/**
 * Sync FEC campaign finance data (committees + top contributions).
 *   pnpm --filter @capiro/api sync:fec
 * Source: api.open.fec.gov/v1/
 * Auth: API key. Key in env: FEC_API_KEY
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenvConfig();

const FEC_BASE = 'https://api.open.fec.gov/v1';
const FEC_KEY = process.env.FEC_API_KEY ?? '';
const DELAY_MS = 500;
const CYCLE = 2026;

async function fetchFec<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const url = new URL(\`\${FEC_BASE}\${path}\`);
  url.searchParams.set('api_key', FEC_KEY);
  url.searchParams.set('per_page', '100');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(\`\${resp.status}\`);
    return (await resp.json()) as T;
  } catch (err) {
    console.warn(\`GET \${path}: \${(err as Error).message}\`);
    return null;
  }
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[fec-sync] starting');
  if (!FEC_KEY) throw new Error('FEC_API_KEY env var is required');

  try {
    // Fetch top committees by receipts for current cycle
    let totalComms = 0;
    for (let page = 1; page <= 10; page++) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const data = await fetchFec<{ results: any[] }>('/committees/', {
        cycle: String(CYCLE), sort: '-receipts', page: String(page),
        committee_type: 'H,S,P', // House, Senate, Presidential
      });
      if (!data?.results?.length) break;

      for (const c of data.results) {
        await (prisma as any).fecCommittee.upsert({
          where: { id: c.committee_id },
          update: {
            name: c.name, designation: c.designation || null,
            type: c.committee_type || null, party: c.party || null,
            candidateId: c.candidate_ids?.[0] || null,
            state: c.state || null, treasurer: c.treasurer_name || null,
            totalReceipts: c.receipts || null, totalDisbursements: c.disbursements || null,
            cashOnHand: c.last_cash_on_hand_end_period || null,
            filingFrequency: c.filing_frequency || null,
            cycle: CYCLE, syncedAt: new Date(),
          },
          create: {
            id: c.committee_id, name: c.name, designation: c.designation || null,
            type: c.committee_type || null, party: c.party || null,
            candidateId: c.candidate_ids?.[0] || null,
            state: c.state || null, treasurer: c.treasurer_name || null,
            totalReceipts: c.receipts || null, totalDisbursements: c.disbursements || null,
            cashOnHand: c.last_cash_on_hand_end_period || null,
            filingFrequency: c.filing_frequency || null, cycle: CYCLE,
          },
        });
        totalComms++;
      }
      console.log(\`[fec-sync] committees page \${page}: \${data.results.length}\`);
    }

    // Fetch recent individual contributions (top by amount)
    let totalContribs = 0;
    for (let page = 1; page <= 5; page++) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const data = await fetchFec<{ results: any[] }>('/schedules/schedule_a/', {
        two_year_transaction_period: String(CYCLE), sort: '-contribution_receipt_amount',
        min_amount: '10000', page: String(page),
      });
      if (!data?.results?.length) break;

      for (const c of data.results) {
        if (!c.contribution_receipt_amount) continue;
        await (prisma as any).fecContribution.create({
          data: {
            committeeId: c.committee_id || '', committeeName: c.committee?.name || '',
            contributorName: c.contributor_name || 'Unknown',
            contributorEmployer: c.contributor_employer || null,
            contributorOccupation: c.contributor_occupation || null,
            contributorState: c.contributor_state || null,
            contributorCity: c.contributor_city || null,
            amount: c.contribution_receipt_amount,
            receiptDate: new Date(c.contribution_receipt_date || Date.now()),
            receiptType: c.receipt_type || null, cycle: CYCLE,
          },
        }).catch(() => {}); // skip dupes
        totalContribs++;
      }
      console.log(\`[fec-sync] contributions page \${page}: \${data.results.length}\`);
    }

    console.log(\`[fec-sync] total: \${totalComms} committees, \${totalContribs} contributions\`);
    console.log(\`[fec-sync] DONE in \${((Date.now() - t0) / 1000).toFixed(1)}s\`);
  } finally { await prisma.$disconnect(); }
}

main().catch((err) => { console.error('[fec-sync] FAILED', err); process.exit(1); });
