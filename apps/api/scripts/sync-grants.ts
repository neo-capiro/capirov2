/**
 * Sync Grants.gov federal grant opportunities (NOFOs).
 *   pnpm --filter @capiro/api sync:grants
 * Source: api.grants.gov/v1/api/search2
 * No auth required.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenvConfig();

const GRANTS_BASE = 'https://api.grants.gov/v1/api/search2';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const DELAY_MS = 300;

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[grants-sync] starting');

  try {
    let total = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const resp = await fetch(GRANTS_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: '',
          oppStatuses: 'posted|forecasted',
          sortBy: 'openDate|desc',
          rows: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
      });
      if (!resp.ok) { console.warn(\`[grants-sync] HTTP \${resp.status}\`); break; }
      const data = await resp.json() as any;
      const hits = data?.oppHits ?? [];
      if (!hits.length) break;

      for (const g of hits) {
        const id = String(g.id || g.opportunityId);
        if (!id) continue;
        await (prisma as any).federalGrant.upsert({
          where: { id },
          update: {
            title: g.title || g.opportunityTitle || 'Untitled',
            agency: g.agency?.name || g.agencyName || 'Unknown',
            subAgency: g.agency?.subName || null,
            opportunityNumber: g.number || g.opportunityNumber || null,
            category: g.opportunityCategory || null,
            fundingInstrument: g.fundingInstrument || null,
            awardCeiling: g.awardCeiling ? parseFloat(g.awardCeiling) : null,
            awardFloor: g.awardFloor ? parseFloat(g.awardFloor) : null,
            estimatedFunding: g.estimatedFunding ? parseFloat(g.estimatedFunding) : null,
            openDate: safeDate(g.openDate),
            closeDate: safeDate(g.closeDate),
            status: g.oppStatus || null,
            description: (g.description || g.synopsis || '')?.slice(0, 10000) || null,
            url: g.docURL || \`https://www.grants.gov/search-results-detail/\${id}\`,
            syncedAt: new Date(),
          },
          create: {
            id,
            title: g.title || g.opportunityTitle || 'Untitled',
            agency: g.agency?.name || g.agencyName || 'Unknown',
            subAgency: g.agency?.subName || null,
            opportunityNumber: g.number || g.opportunityNumber || null,
            category: g.opportunityCategory || null,
            fundingInstrument: g.fundingInstrument || null,
            awardCeiling: g.awardCeiling ? parseFloat(g.awardCeiling) : null,
            awardFloor: g.awardFloor ? parseFloat(g.awardFloor) : null,
            estimatedFunding: g.estimatedFunding ? parseFloat(g.estimatedFunding) : null,
            openDate: safeDate(g.openDate),
            closeDate: safeDate(g.closeDate),
            status: g.oppStatus || null,
            description: (g.description || g.synopsis || '')?.slice(0, 10000) || null,
            url: g.docURL || \`https://www.grants.gov/search-results-detail/\${id}\`,
          },
        });
        total++;
      }
      console.log(\`[grants-sync] page \${page + 1}: \${hits.length} grants (total: \${total})\`);
      if (hits.length < PAGE_SIZE) break;
    }

    console.log(\`[grants-sync] total: \${total}\`);
    console.log(\`[grants-sync] DONE in \${((Date.now() - t0) / 1000).toFixed(1)}s\`);
  } finally { await prisma.$disconnect(); }
}

main().catch((err) => { console.error('[grants-sync] FAILED', err); process.exit(1); });
