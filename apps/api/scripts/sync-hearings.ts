/**
 * Sync Congressional committee hearings from Congress.gov API.
 *   pnpm --filter @capiro/api sync:hearings
 * Source: api.congress.gov/v3/committee-report and committee RSS
 * Auth: Congress.gov API key (same as sync-congress.ts)
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenvConfig();

const CONGRESS_BASE = 'https://api.congress.gov/v3';
const API_KEY = process.env.CONGRESS_API_KEY ?? '';
const DELAY_MS = 300;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(\`\${resp.status}\`);
    return (await resp.json()) as T;
  } catch (err) {
    console.warn(\`GET \${url}: \${(err as Error).message}\`);
    return null;
  }
}

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[hearings-sync] starting');
  if (!API_KEY) throw new Error('CONGRESS_API_KEY env var is required');

  try {
    let total = 0;
    for (const congress of [118, 119]) {
      let offset = 0;
      for (let page = 0; page < 20; page++) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
        const url = \`\${CONGRESS_BASE}/hearing/\${congress}?api_key=\${API_KEY}&format=json&limit=100&offset=\${offset}\`;
        const data = await fetchJson<{ hearings: any[] }>(url);
        if (!data?.hearings?.length) break;

        for (const h of data.hearings) {
          const date = safeDate(h.date);
          if (!date) continue;

          const id = h.jacketNumber ? \`\${congress}-\${h.jacketNumber}\` : \`hearing-\${congress}-\${offset}-\${total}\`;
          const chamber = h.chamber || (h.type?.includes('Senate') ? 'Senate' : h.type?.includes('House') ? 'House' : 'Joint');

          await (prisma as any).committeeHearing.upsert({
            where: { id },
            update: {
              title: h.title || 'Untitled', chamber,
              committeeName: h.committees?.[0]?.name || 'Unknown',
              committeeCode: h.committees?.[0]?.systemCode || null,
              date, location: h.location || null,
              type: h.type || 'hearing', url: h.url || null,
              syncedAt: new Date(),
            },
            create: {
              id, title: h.title || 'Untitled', chamber,
              committeeName: h.committees?.[0]?.name || 'Unknown',
              committeeCode: h.committees?.[0]?.systemCode || null,
              date, location: h.location || null,
              type: h.type || 'hearing', url: h.url || null,
            },
          });
          total++;
        }

        offset += 100;
        if (!data.hearings.length || data.hearings.length < 100) break;
        console.log(\`[hearings-sync] \${congress}th Congress: \${total} hearings...\`);
      }
    }

    console.log(\`[hearings-sync] total: \${total}\`);
    console.log(\`[hearings-sync] DONE in \${((Date.now() - t0) / 1000).toFixed(1)}s\`);
  } finally { await prisma.$disconnect(); }
}

main().catch((err) => { console.error('[hearings-sync] FAILED', err); process.exit(1); });
