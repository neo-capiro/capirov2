/**
 * Sync Congress.gov legislative data (bills from 118th and 119th Congress).
 *
 *   pnpm --filter @capiro/api sync:congress
 *
 * Source: https://api.congress.gov/v3/ — Congress.gov API.
 * Fetches bills, filters to lobbying-relevant policy areas.
 *
 * Steps:
 *   1. Paginate through 118th + 119th Congress bill lists
 *   2. For each bill, fetch detail (policyArea, sponsor, etc.)
 *   3. Fetch subjects and committees for relevant bills
 *   4. Upsert into congress_bill table
 *
 * Rate limit: ~5000 req/hour with API key. Script stays well under that.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenvConfig();

const CONGRESS_BASE = 'https://api.congress.gov/v3';
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY ?? '';
const LIMIT = 100;
// Fetch up to 50 pages per congress (5000 bills per congress)
const MAX_PAGES_PER_CONGRESS = 50;
const TARGET_CONGRESSES = [118, 119];

// Policy areas relevant to lobbying. Used to filter bills for subject/committee detail fetching.
const LOBBYING_POLICY_AREAS = new Set([
  'Health',
  'Taxation',
  'Armed Forces and National Security',
  'Energy',
  'Finance and Financial Sector',
  'Environmental Protection',
  'Transportation and Public Works',
  'Science, Technology, Communications',
  'International Affairs',
  'Government Operations and Politics',
  'Labor and Employment',
  'Agriculture and Food',
  'Housing and Community Development',
  'Commerce',
  'Economics and Public Finance',
  'Education',
  'Immigration',
  'Law',
  'Social Welfare',
  'Public Lands and Natural Resources',
]);

// ─── Congress.gov API types ───────────────────────────────────────────────────

interface CongressBillSummary {
  congress: number;
  latestAction?: { actionDate: string | null; text: string | null } | null;
  number: string;
  originChamber?: string | null;
  originChamberCode?: string | null;
  title: string;
  type: string;
  updateDate?: string | null;
  updateDateIncludingText?: string | null;
  url?: string | null;
  introducedDate?: string | null;
  sponsor?: {
    bioguideId?: string | null;
    district?: number | null;
    firstName?: string | null;
    fullName?: string | null;
    isByRequest?: string | null;
    lastName?: string | null;
    middleName?: string | null;
    party?: string | null;
    state?: string | null;
  } | null;
  policyArea?: { name: string } | null;
  cosponsors?: { count?: number } | null;
}

interface CongressBillDetail {
  bill: {
    congress: number;
    number: string;
    type: string;
    title: string;
    introducedDate?: string | null;
    sponsor?: CongressBillSummary['sponsor'];
    latestAction?: CongressBillSummary['latestAction'];
    policyArea?: { name: string } | null;
    subjects?: {
      legislativeSubjects?: { name: string }[];
      policyArea?: { name: string } | null;
    } | null;
    committees?: {
      count?: number;
      url?: string;
    } | null;
    cosponsors?: { count?: number } | null;
    originChamber?: string | null;
    updateDate?: string | null;
    url?: string | null;
  };
}

interface CongressSubjectsResponse {
  subjects?: {
    legislativeSubjects?: { name: string }[];
    policyArea?: { name: string } | null;
  };
}

interface CongressCommitteesResponse {
  committees?: {
    activities?: { date?: string; name?: string }[];
    chamber?: string;
    name?: string;
    systemCode?: string;
    type?: string;
    url?: string;
  }[];
}

interface CongressBillListResponse {
  bills: CongressBillSummary[];
  pagination: {
    count: number;
    next?: string | null;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function congressUrl(path: string, params: Record<string, string | number> = {}): string {
  const url = new URL(`${CONGRESS_BASE}${path}`);
  url.searchParams.set('api_key', CONGRESS_API_KEY);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const resp = await fetch(url);
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return (await resp.json()) as T;
  } catch (err) {
    throw new Error(`GET ${url}: ${err instanceof Error ? err.message : err}`);
  }
}

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function billId(congress: number, type: string, number: string): string {
  return `${congress}-${type.toLowerCase()}-${number}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[congress-sync] starting');

  try {
    if (!CONGRESS_API_KEY) {
      throw new Error('CONGRESS_API_KEY env var is required');
    }

    let totalBills = 0;

    for (const congress of TARGET_CONGRESSES) {
      console.log(`[congress-sync] fetching ${congress}th Congress bills`);
      let offset = 0;
      let congressBills = 0;

      for (let pageNum = 0; pageNum < MAX_PAGES_PER_CONGRESS; pageNum++) {
        let listResp: CongressBillListResponse | null;
        try {
          listResp = await fetchJson<CongressBillListResponse>(
            congressUrl(`/bill/${congress}`, { limit: LIMIT, offset }),
          );
        } catch (err) {
          console.warn(`[congress-sync] failed to fetch bill list congress=${congress} offset=${offset}:`, err instanceof Error ? err.message : err);
          break;
        }

        if (!listResp?.bills?.length) break;

        for (const bill of listResp.bills) {
          try {
            const type = bill.type?.toLowerCase() ?? '';
            const id = billId(congress, type, bill.number);

            // Fetch bill detail (includes policyArea and sponsor).
            let detail: CongressBillDetail | null = null;
            try {
              detail = await fetchJson<CongressBillDetail>(
                congressUrl(`/bill/${congress}/${type}/${bill.number}`),
              );
            } catch (err) {
              // Proceed without detail — will use list data
            }

            const billData = detail?.bill ?? bill as unknown as CongressBillDetail['bill'];
            const policyAreaName = billData.policyArea?.name ?? bill.policyArea?.name ?? null;
            const isLobbyingRelevant = policyAreaName ? LOBBYING_POLICY_AREAS.has(policyAreaName) : false;

            // Fetch subjects and committees only for lobbying-relevant bills.
            let subjects: string[] = [];
            let committees: object[] = [];

            if (isLobbyingRelevant) {
              try {
                const subjectsResp = await fetchJson<CongressSubjectsResponse>(
                  congressUrl(`/bill/${congress}/${type}/${bill.number}/subjects`),
                );
                if (subjectsResp?.subjects?.legislativeSubjects) {
                  subjects = subjectsResp.subjects.legislativeSubjects
                    .map((s) => s.name)
                    .filter((s): s is string => typeof s === 'string' && s.length > 0);
                }
              } catch {
                // subjects stay empty
              }

              try {
                const committeesResp = await fetchJson<CongressCommitteesResponse>(
                  congressUrl(`/bill/${congress}/${type}/${bill.number}/committees`),
                );
                if (committeesResp?.committees) {
                  committees = committeesResp.committees.map((c) => ({
                    name: c.name ?? null,
                    chamber: c.chamber ?? null,
                    type: c.type ?? null,
                    systemCode: c.systemCode ?? null,
                  }));
                }
              } catch {
                // committees stay empty
              }
            }

            const sponsor = billData.sponsor ?? bill.sponsor ?? null;
            const latestAction = billData.latestAction ?? bill.latestAction ?? null;

            await prisma.congressBill.upsert({
              where: { id },
              update: {
                title: billData.title ?? bill.title,
                introducedDate: safeDate(billData.introducedDate ?? bill.introducedDate),
                sponsorName: sponsor?.fullName ?? null,
                sponsorState: sponsor?.state ?? null,
                sponsorParty: sponsor?.party ?? null,
                latestActionText: latestAction?.text ?? null,
                latestActionDate: safeDate(latestAction?.actionDate),
                policyArea: policyAreaName,
                subjects,
                committees: committees as object,
                cosponsorsCount: billData.cosponsors?.count ?? bill.cosponsors?.count ?? 0,
                originChamber: billData.originChamber ?? bill.originChamber ?? null,
                updateDate: safeDate(billData.updateDate ?? bill.updateDate),
                url: bill.url ?? null,
                lastSyncedAt: new Date(),
              },
              create: {
                id,
                congress,
                billType: type,
                billNumber: bill.number,
                title: billData.title ?? bill.title,
                introducedDate: safeDate(billData.introducedDate ?? bill.introducedDate),
                sponsorName: sponsor?.fullName ?? null,
                sponsorState: sponsor?.state ?? null,
                sponsorParty: sponsor?.party ?? null,
                latestActionText: latestAction?.text ?? null,
                latestActionDate: safeDate(latestAction?.actionDate),
                policyArea: policyAreaName,
                subjects,
                committees: committees as object,
                cosponsorsCount: billData.cosponsors?.count ?? bill.cosponsors?.count ?? 0,
                originChamber: billData.originChamber ?? bill.originChamber ?? null,
                updateDate: safeDate(billData.updateDate ?? bill.updateDate),
                url: bill.url ?? null,
              },
            });

            congressBills++;
            totalBills++;
            if (totalBills % 500 === 0) {
              console.log(`[congress-sync]   ${totalBills} bills processed...`);
            }
          } catch (err) {
            console.warn(`[congress-sync] skip bill:`, err instanceof Error ? err.message : err);
          }
        }

        offset += LIMIT;
        if (!listResp.pagination?.next) break;
      }

      console.log(`[congress-sync] ${congress}th Congress: ${congressBills} bills`);
    }

    console.log(`[congress-sync] total bills: ${totalBills}`);
    const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
    console.log(`[congress-sync] DONE in ${elapsed}m`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[congress-sync] FAILED', err);
  process.exit(1);
});
