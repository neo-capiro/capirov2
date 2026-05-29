/**
 * Sync Open States, state legislature bills and legislators.
 *   pnpm --filter @capiro/api sync:openstates
 * Source: v3.openstates.org/
 * Auth: Free API key. Key in env: OPENSTATES_API_KEY
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenvConfig();

const OS_BASE = 'https://v3.openstates.org';
const OS_KEY = process.env.OPENSTATES_API_KEY ?? '';
const DELAY_MS = 2000;
const MAX_RETRIES = 3;
const BATCH_SIZE = 10; // process 10 states per run to avoid rate limits
// All states + DC
const ALL_STATES = [
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'dc', 'fl',
  'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me',
  'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh',
  'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri',
  'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy',
];
// Pick batch based on day of month to cycle through all states
const batchIndex = new Date().getDate() % Math.ceil(ALL_STATES.length / BATCH_SIZE);
const PRIORITY_STATES = ALL_STATES.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);

async function fetchOS<T>(path: string, params: Record<string, string> = {}): Promise<T | null> {
  const url = new URL(`${OS_BASE}${path}`);
  url.searchParams.set('apikey', OS_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url.toString());
      if (resp.status === 429) {
        const wait = Math.min(DELAY_MS * Math.pow(2, attempt + 1), 30000);
        console.warn(`GET ${path}: 429 rate limited, retrying in ${wait}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!resp.ok) throw new Error(`${resp.status}`);
      return (await resp.json()) as T;
    } catch (err) {
      if (attempt < MAX_RETRIES && (err as Error).message?.includes('429')) continue;
      console.warn(`GET ${path}: ${(err as Error).message}`);
      return null;
    }
  }
  return null;
}

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[openstates-sync] starting');
  console.log(`[openstates-sync] batch ${batchIndex}: ${PRIORITY_STATES.map(s => s.toUpperCase()).join(', ')}`);
  if (!OS_KEY) throw new Error('OPENSTATES_API_KEY env var is required');

  try {
    let totalBills = 0;
    let totalPeople = 0;

    for (const state of PRIORITY_STATES) {
      // Fetch recent bills (updated in last 30 days)
      const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const bills = await fetchOS<{ results: any[]; pagination: { max_page: number } }>(
        '/bills', { jurisdiction: state, updated_since: since, per_page: '100', page: '1', sort: 'updated_desc' }
      );

      if (bills?.results) {
        for (const b of bills.results) {
          const sponsor = b.sponsorships?.[0];
          const lastAction = b.latest_action;
          await (prisma as any).stateBill.upsert({
            where: { id: b.id },
            update: {
              title: b.title || 'Untitled', chamber: b.from_organization?.classification || null,
              classification: b.classification || [], subjects: b.subject || [],
              sponsorName: sponsor?.name || null, sponsorParty: sponsor?.party || null,
              latestActionDate: safeDate(lastAction?.date), latestActionText: lastAction?.description || null,
              url: b.openstates_url || null, syncedAt: new Date(),
            },
            create: {
              id: b.id, state: state.toUpperCase(), session: b.legislative_session?.identifier || '',
              identifier: b.identifier || '', title: b.title || 'Untitled',
              chamber: b.from_organization?.classification || null,
              classification: b.classification || [], subjects: b.subject || [],
              sponsorName: sponsor?.name || null, sponsorParty: sponsor?.party || null,
              latestActionDate: safeDate(lastAction?.date), latestActionText: lastAction?.description || null,
              url: b.openstates_url || null,
            },
          });
          totalBills++;
        }
        console.log(`[openstates-sync] ${state.toUpperCase()} bills: ${bills.results.length}`);
      }

      // Fetch current legislators
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const people = await fetchOS<{ results: any[] }>(
        '/people', { jurisdiction: state, per_page: '200', page: '1' }
      );

      if (people?.results) {
        for (const p of people.results) {
          const currentRole = p.current_role;
          await (prisma as any).stateLegislator.upsert({
            where: { id: p.id },
            update: {
              name: p.name, state: state.toUpperCase(),
              chamber: currentRole?.org_classification || null,
              district: currentRole?.district?.toString() || null,
              party: p.party || null, email: p.email || null,
              image: p.image || null, url: p.openstates_url || null,
              committees: (p.current_memberships || []).filter((m: any) => m.organization?.classification === 'committee')
                .map((m: any) => ({ name: m.organization?.name, role: m.role })),
              active: true, syncedAt: new Date(),
            },
            create: {
              id: p.id, name: p.name, state: state.toUpperCase(),
              chamber: currentRole?.org_classification || null,
              district: currentRole?.district?.toString() || null,
              party: p.party || null, email: p.email || null,
              image: p.image || null, url: p.openstates_url || null,
              committees: (p.current_memberships || []).filter((m: any) => m.organization?.classification === 'committee')
                .map((m: any) => ({ name: m.organization?.name, role: m.role })),
            },
          });
          totalPeople++;
        }
        console.log(`[openstates-sync] ${state.toUpperCase()} legislators: ${people.results.length}`);
      }
    }

    console.log(`[openstates-sync] total: ${totalBills} bills, ${totalPeople} legislators`);
    console.log(`[openstates-sync] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } finally { await prisma.$disconnect(); }
}

main().catch((err) => { console.error('[openstates-sync] FAILED', err); process.exit(1); });