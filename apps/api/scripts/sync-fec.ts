/**
 * Sync FEC campaign finance data (PAC committees + contributions).
 *
 *   pnpm --filter @capiro/api sync:fec
 *
 * Source: https://api.open.fec.gov/v1/ — public FEC API.
 * Focuses on lobbying-related PACs in tech, defense, energy, healthcare.
 *
 * Steps:
 *   1. Fetch top committees by total receipts (PAC types: N, Q, O, V, W)
 *   2. For each committee, fetch recent Schedule A contributions
 *
 * Rate limit: ~1000 req/day per key. Script stays well under that.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

dotenvConfig();

const FEC_BASE = 'https://api.open.fec.gov/v1';
const FEC_API_KEY = process.env.FEC_API_KEY ?? '';
const PER_PAGE = 100;

// ─── FEC API types ────────────────────────────────────────────────────────────

interface FecPage<T> {
  results: T[];
  pagination: {
    per_page: number;
    page: number;
    pages: number;
    count: number;
  };
}

interface FecCommitteeApi {
  committee_id: string;
  name: string;
  committee_type: string | null;
  committee_type_full: string | null;
  designation: string | null;
  party: string | null;
  state: string | null;
  treasurer_name: string | null;
  receipts: number | null;
  disbursements: number | null;
  cash_on_hand_end_period: number | null;
  cycles: number[] | null;
}

interface FecScheduleAApi {
  committee_id: string;
  committee: { name: string | null } | null;
  candidate_id: string | null;
  candidate_name: string | null;
  contributor_name: string | null;
  contributor_employer: string | null;
  contributor_occupation: string | null;
  contribution_receipt_amount: number | null;
  contribution_receipt_date: string | null;
  receipt_type: string | null;
  memo_text: string | null;
  contributor_state: string | null;
  two_year_transaction_period: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fecUrl(path: string, params: Record<string, string | number> = {}): string {
  const url = new URL(`${FEC_BASE}${path}`);
  url.searchParams.set('api_key', FEC_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`GET ${url} → ${resp.status} ${resp.statusText}`);
  return (await resp.json()) as T;
}

// Lobbying-relevant PAC types: N=Nonconnected, Q=Leadership, O=Super PAC,
// V=Hybrid Super PAC, W=Hybrid. Also include U=Unauthorized committees.
const COMMITTEE_TYPES = ['N', 'Q', 'O', 'V', 'W', 'U'];

// Industry keywords to focus on lobbying-relevant PACs.
const RELEVANT_KEYWORDS = [
  'tech', 'software', 'digital', 'cyber', 'data',
  'defense', 'aerospace', 'military', 'security',
  'energy', 'oil', 'gas', 'nuclear', 'renewable', 'utility',
  'health', 'pharma', 'medical', 'hospital', 'biotech',
  'finance', 'bank', 'insurance', 'invest',
  'telecom', 'communications', 'media', 'broadband',
  'transport', 'auto', 'aviation', 'rail',
  'agriculture', 'farm',
  'chamber', 'association', 'industry', 'business',
];

function isRelevant(name: string): boolean {
  const lower = name.toLowerCase();
  return RELEVANT_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[fec-sync] starting');

  try {
    if (!FEC_API_KEY) {
      throw new Error('FEC_API_KEY env var is required');
    }

    // ── 1. Fetch top committees ───────────────────────────────────────────────
    console.log('[fec-sync] fetching top PAC committees');
    const committeeIds: string[] = [];
    let totalCommittees = 0;

    for (const ctype of COMMITTEE_TYPES) {
      let page = 1;
      // Fetch up to 3 pages per type (300 committees per type max)
      while (page <= 3) {
        let resp: FecPage<FecCommitteeApi>;
        try {
          resp = await fetchJson<FecPage<FecCommitteeApi>>(
            fecUrl('/committees/', {
              committee_type: ctype,
              sort: '-receipts',
              per_page: PER_PAGE,
              page,
            }),
          );
        } catch (err) {
          console.warn(`[fec-sync] failed to fetch committees type=${ctype} page=${page}:`, err instanceof Error ? err.message : err);
          break;
        }

        for (const c of resp.results) {
          try {
            if (!c.committee_id) continue;
            await prisma.fecCommittee.upsert({
              where: { id: c.committee_id },
              update: {
                name: c.name,
                committeeType: c.committee_type ?? null,
                designation: c.designation ?? null,
                party: c.party ?? null,
                state: c.state ?? null,
                treasurerName: c.treasurer_name ?? null,
                totalReceipts: c.receipts ?? null,
                totalDisbursements: c.disbursements ?? null,
                cashOnHand: c.cash_on_hand_end_period ?? null,
                cycles: (c.cycles ?? []).filter((x): x is number => typeof x === 'number'),
                lastSyncedAt: new Date(),
              },
              create: {
                id: c.committee_id,
                name: c.name,
                committeeType: c.committee_type ?? null,
                designation: c.designation ?? null,
                party: c.party ?? null,
                state: c.state ?? null,
                treasurerName: c.treasurer_name ?? null,
                totalReceipts: c.receipts ?? null,
                totalDisbursements: c.disbursements ?? null,
                cashOnHand: c.cash_on_hand_end_period ?? null,
                cycles: (c.cycles ?? []).filter((x): x is number => typeof x === 'number'),
              },
            });

            if (isRelevant(c.name)) committeeIds.push(c.committee_id);
            totalCommittees++;
          } catch (err) {
            console.warn(`[fec-sync] skip committee ${c.committee_id}:`, err instanceof Error ? err.message : err);
          }
        }

        if (resp.pagination.page >= resp.pagination.pages) break;
        page++;
      }
    }
    console.log(`[fec-sync] upserted ${totalCommittees} committees, ${committeeIds.length} relevant for contributions`);

    // ── 2. Fetch contributions for relevant committees ────────────────────────
    let totalContributions = 0;
    const dedupSeen = new Set<string>();

    for (const committeeId of committeeIds) {
      let page = 1;
      // Fetch up to 5 pages per committee (500 contributions max)
      while (page <= 5) {
        let resp: FecPage<FecScheduleAApi>;
        try {
          resp = await fetchJson<FecPage<FecScheduleAApi>>(
            fecUrl('/schedules/schedule_a/', {
              committee_id: committeeId,
              sort: '-contribution_receipt_date',
              per_page: PER_PAGE,
              page,
            }),
          );
        } catch (err) {
          console.warn(`[fec-sync] failed to fetch schedule_a for ${committeeId} page=${page}:`, err instanceof Error ? err.message : err);
          break;
        }

        for (const item of resp.results) {
          try {
            if (!item.committee_id || item.contribution_receipt_amount == null) continue;
            // Deduplicate by composite key (committee + contributor + date + amount)
            const dedupeKey = [
              item.committee_id,
              item.contributor_name ?? '',
              item.contribution_receipt_date ?? '',
              String(item.contribution_receipt_amount),
            ].join('|');
            if (dedupSeen.has(dedupeKey)) continue;
            dedupSeen.add(dedupeKey);

            const contribDate = item.contribution_receipt_date
              ? new Date(item.contribution_receipt_date)
              : null;

            await prisma.fecContribution.create({
              data: {
                id: randomUUID(),
                committeeId: item.committee_id,
                committeeName: item.committee?.name ?? null,
                candidateId: item.candidate_id ?? null,
                candidateName: item.candidate_name ?? null,
                contributorName: item.contributor_name ?? null,
                contributorEmployer: item.contributor_employer ?? null,
                contributorOccupation: item.contributor_occupation ?? null,
                amount: item.contribution_receipt_amount,
                contributionDate: contribDate && !isNaN(contribDate.getTime()) ? contribDate : null,
                receiptType: item.receipt_type ?? null,
                memoText: item.memo_text ?? null,
                state: item.contributor_state ?? null,
                cycle: item.two_year_transaction_period ?? new Date().getFullYear(),
              },
            });

            totalContributions++;
          } catch (err) {
            console.warn(`[fec-sync] skip contribution:`, err instanceof Error ? err.message : err);
          }
        }

        if (resp.pagination.page >= resp.pagination.pages) break;
        page++;
      }

      if (totalContributions % 1000 === 0 && totalContributions > 0) {
        console.log(`[fec-sync]   ${totalContributions} contributions...`);
      }
    }
    console.log(`[fec-sync] inserted ${totalContributions} contributions`);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[fec-sync] DONE in ${elapsed}s`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[fec-sync] FAILED', err);
  process.exit(1);
});
