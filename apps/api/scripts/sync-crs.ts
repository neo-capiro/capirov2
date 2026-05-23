/**
 * Sync CRS (Congressional Research Service) reports.
 *   pnpm --filter @capiro/api sync:crs
 * Source: Congress.gov API v3 /crsreport endpoint (primary)
 *         EveryCRSReport.com JSON index (fallback)
 * Auth: CONGRESS_API_KEY (free, same key as sync-congress.ts)
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenvConfig();

const CONGRESS_BASE = 'https://api.congress.gov/v3';
const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY ?? '';
const EVERYCRS_API = 'https://www.everycrsreport.com/reports.json';
const DELAY_MS = 500;

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

interface CRSReport {
  id: string;
  title: string;
  date: Date | null;
  authors: string[];
  topics: string[];
  summary: string | null;
  pdfUrl: string | null;
  htmlUrl: string | null;
}

async function fetchFromCongressAPI(): Promise<CRSReport[]> {
  if (!CONGRESS_API_KEY) {
    console.warn('[crs-sync] no CONGRESS_API_KEY, skipping Congress.gov API');
    return [];
  }
  console.log('[crs-sync] trying Congress.gov API...');
  const reports: CRSReport[] = [];
  let offset = 0;

  for (let page = 0; page < 50; page++) {
    await new Promise((r) => setTimeout(r, DELAY_MS));
    try {
      const url = `${CONGRESS_BASE}/crsreport?api_key=${CONGRESS_API_KEY}&format=json&limit=100&offset=${offset}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        console.warn(`[crs-sync] Congress API HTTP ${resp.status}`);
        break;
      }
      const data = await resp.json() as any;
      const items = data?.crsReports ?? data?.reports ?? [];
      if (!items.length) break;

      for (const r of items) {
        const id = r.number || r.id;
        if (!id) continue;
        reports.push({
          id,
          title: r.title || 'Untitled',
          date: safeDate(r.latestUpdateDate || r.publishDate || r.date),
          authors: (r.authors || []).map((a: any) => a.name || String(a)).filter(Boolean),
          topics: r.topics || r.subjects || [],
          summary: r.summary?.slice(0, 10000) || null,
          pdfUrl: r.pdfUrl || null,
          htmlUrl: r.htmlUrl || `https://crsreports.congress.gov/product/details?prodcode=${id}`,
        });
      }
      offset += 100;
      console.log(`[crs-sync] Congress API page ${page + 1}: ${items.length} reports (total: ${reports.length})`);
      if (items.length < 100) break;
    } catch (err) {
      console.warn(`[crs-sync] Congress API error: ${(err as Error).message}`);
      break;
    }
  }
  return reports;
}

async function fetchFromEveryCRS(): Promise<CRSReport[]> {
  console.log('[crs-sync] trying EveryCRSReport.com...');
  try {
    const resp = await fetch(EVERYCRS_API, {
      headers: { 'User-Agent': 'Capiro/1.0 (neo@capiro.ai)' },
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw = (await resp.json()) as any[];
    console.log(`[crs-sync] EveryCRS: ${raw.length} reports in index`);

    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

    const reports: CRSReport[] = [];
    for (const r of raw) {
      const latestVersion = r.versions?.[0];
      if (!latestVersion) continue;
      const date = safeDate(latestVersion.date);
      if (date && date < fiveYearsAgo) continue;
      const id = r.number || r.id;
      if (!id) continue;
      reports.push({
        id,
        title: latestVersion.title || r.title || 'Untitled',
        date,
        authors: (r.authors || []).map((a: any) => a.name || String(a)).filter(Boolean),
        topics: r.topics || [],
        summary: latestVersion.summary?.slice(0, 10000) || null,
        pdfUrl: latestVersion.formats?.find((f: any) => f.format === 'PDF')?.url || null,
        htmlUrl: latestVersion.formats?.find((f: any) => f.format === 'HTML')?.url || `https://crsreports.congress.gov/product/details?prodcode=${id}`,
      });
    }
    return reports;
  } catch (err) {
    console.warn(`[crs-sync] EveryCRS failed: ${(err as Error).message}`);
    return [];
  }
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[crs-sync] starting');

  try {
    // Try Congress API first, fall back to EveryCRSReport
    let reports = await fetchFromCongressAPI();
    if (reports.length === 0) {
      reports = await fetchFromEveryCRS();
    }

    if (reports.length === 0) {
      console.warn('[crs-sync] no CRS data from any source');
      return;
    }

    let total = 0;
    for (const r of reports) {
      await (prisma as any).crsReport.upsert({
        where: { id: r.id },
        update: {
          title: r.title,
          date: r.date,
          authors: r.authors,
          topics: r.topics,
          summary: r.summary,
          pdfUrl: r.pdfUrl,
          htmlUrl: r.htmlUrl,
          active: true,
          syncedAt: new Date(),
        },
        create: {
          id: r.id,
          title: r.title,
          date: r.date,
          authors: r.authors,
          topics: r.topics,
          summary: r.summary,
          pdfUrl: r.pdfUrl,
          htmlUrl: r.htmlUrl,
        },
      });
      total++;
      if (total % 500 === 0) console.log(`[crs-sync]   ${total} reports...`);
    }

    console.log(`[crs-sync] total: ${total}`);
    console.log(`[crs-sync] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } finally { await prisma.$disconnect(); }
}

main().catch((err) => { console.error('[crs-sync] FAILED', err); process.exit(1); });
