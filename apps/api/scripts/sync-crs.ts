/**
 * Sync CRS (Congressional Research Service) reports.
 *   pnpm --filter @capiro/api sync:crs
 * Source: crsreports.congress.gov
 * No auth. Scrapes the public index.
 * Also uses EveryCRSReport.com API as backup.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenvConfig();

const CRS_API = 'https://www.everycrsreport.com/reports.json';
const DELAY_MS = 500;

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[crs-sync] starting');

  try {
    // EveryCRSReport.com has a comprehensive JSON index
    const resp = await fetch(CRS_API, {
      headers: { 'User-Agent': 'Capiro/1.0 (neo@capiro.ai)' },
    });
    if (!resp.ok) throw new Error(\`HTTP \${resp.status}\`);
    const reports = (await resp.json()) as any[];

    console.log(\`[crs-sync] found \${reports.length} reports\`);
    let total = 0;

    // Only process reports from last 3 years
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

    for (const r of reports) {
      const latestVersion = r.versions?.[0];
      if (!latestVersion) continue;

      const date = safeDate(latestVersion.date);
      if (date && date < threeYearsAgo) continue;

      const id = r.number || r.id;
      if (!id) continue;

      await (prisma as any).crsReport.upsert({
        where: { id },
        update: {
          title: latestVersion.title || r.title || 'Untitled',
          date,
          authors: (r.authors || []).map((a: any) => a.name || a).filter(Boolean),
          topics: r.topics || [],
          summary: latestVersion.summary?.slice(0, 10000) || null,
          pdfUrl: latestVersion.formats?.find((f: any) => f.format === 'PDF')?.url || null,
          htmlUrl: latestVersion.formats?.find((f: any) => f.format === 'HTML')?.url || \`https://crsreports.congress.gov/product/details?prodcode=\${id}\`,
          active: r.active !== false,
          syncedAt: new Date(),
        },
        create: {
          id,
          title: latestVersion.title || r.title || 'Untitled',
          date,
          authors: (r.authors || []).map((a: any) => a.name || a).filter(Boolean),
          topics: r.topics || [],
          summary: latestVersion.summary?.slice(0, 10000) || null,
          pdfUrl: latestVersion.formats?.find((f: any) => f.format === 'PDF')?.url || null,
          htmlUrl: latestVersion.formats?.find((f: any) => f.format === 'HTML')?.url || \`https://crsreports.congress.gov/product/details?prodcode=\${id}\`,
        },
      });
      total++;

      if (total % 500 === 0) console.log(\`[crs-sync]   \${total} reports...\`);
    }

    console.log(\`[crs-sync] total: \${total}\`);
    console.log(\`[crs-sync] DONE in \${((Date.now() - t0) / 1000).toFixed(1)}s\`);
  } finally { await prisma.$disconnect(); }
}

main().catch((err) => { console.error('[crs-sync] FAILED', err); process.exit(1); });
