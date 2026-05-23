/**
 * Sync SEC EDGAR filings for lobbying-relevant companies.
 *
 *   pnpm --filter @capiro/api sync:sec
 *
 * Source: data.sec.gov/submissions/CIK*.json
 * Rate limit: 10 req/sec with User-Agent header. No API key required.
 *
 * Strategy: maintain a curated list of CIKs for major lobbying clients
 * (defense contractors, pharma, energy, tech, finance). Fetch recent filings.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenvConfig();

const EDGAR_BASE = 'https://data.sec.gov';
const USER_AGENT = 'Capiro/1.0 (neo@capiro.ai)';
const DELAY_MS = 120; // ~8 req/sec, under the 10/sec limit

// Top lobbying-connected companies by CIK (zero-padded to 10 digits)
const TARGET_CIKS = [
  { cik: '0000320193', name: 'Apple Inc' },
  { cik: '0000789019', name: 'Microsoft Corp' },
  { cik: '0001652044', name: 'Alphabet Inc' },
  { cik: '0001018724', name: 'Amazon.com Inc' },
  { cik: '0001326801', name: 'Meta Platforms' },
  { cik: '0000732717', name: 'AT&T Inc' },
  { cik: '0000021344', name: 'Coca-Cola Co' },
  { cik: '0000078003', name: 'Pfizer Inc' },
  { cik: '0000310158', name: 'Merck & Co' },
  { cik: '0000040545', name: 'General Electric' },
  { cik: '0000034088', name: 'Exxon Mobil' },
  { cik: '0000093410', name: 'Chevron Corp' },
  { cik: '0000012927', name: 'Boeing Co' },
  { cik: '0000936468', name: 'Lockheed Martin' },
  { cik: '0000818479', name: 'Raytheon Technologies' },
  { cik: '0000049196', name: 'Halliburton Co' },
  { cik: '0000070858', name: 'Bank of America' },
  { cik: '0000019617', name: 'JPMorgan Chase' },
  { cik: '0000886982', name: 'Goldman Sachs' },
  { cik: '0000831001', name: 'Citigroup Inc' },
  { cik: '0000077476', name: 'PepsiCo Inc' },
  { cik: '0000004962', name: 'Johnson & Johnson' },
  { cik: '0000318154', name: 'Amgen Inc' },
  { cik: '0000027419', name: 'Comcast Corp' },
  { cik: '0001551152', name: 'Uber Technologies' },
  { cik: '0001467858', name: 'Tesla Inc' },
  { cik: '0001326160', name: 'Walmart Inc' },
  { cik: '0000885590', name: 'UnitedHealth Group' },
  { cik: '0001166559', name: 'Northrop Grumman' },
  { cik: '0000091142', name: 'General Dynamics' },
];

// Lobbying-relevant form types
const RELEVANT_FORMS = new Set([
  '10-K', '10-Q', '8-K', 'DEF 14A', 'S-1', '20-F',
  '10-K/A', '10-Q/A', '8-K/A', 'DEFA14A', 'SC 13D', 'SC 13G',
]);

interface EdgarSubmission {
  cik: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  name: string;
  stateOfIncorporation: string;
  fiscalYearEnd: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    return (await resp.json()) as T;
  } catch (err) {
    console.warn(`GET ${url}: ${err instanceof Error ? err.message : err}`);
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
  console.log('[sec-sync] starting');

  try {
    let total = 0;

    for (const target of TARGET_CIKS) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
      const data = await fetchJson<EdgarSubmission>(
        `${EDGAR_BASE}/submissions/CIK${target.cik}.json`,
      );
      if (!data?.filings?.recent) {
        console.warn(`[sec-sync] no data for ${target.name} (${target.cik})`);
        continue;
      }

      const recent = data.filings.recent;
      const count = recent.accessionNumber.length;
      let companyFilings = 0;

      for (let i = 0; i < count; i++) {
        const form = recent.form[i];
        if (!RELEVANT_FORMS.has(form)) continue;

        const accession = recent.accessionNumber[i];
        const filingDate = safeDate(recent.filingDate[i]);
        if (!filingDate) continue;

        // Only sync filings from last 3 years
        const threeYearsAgo = new Date();
        threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
        if (filingDate < threeYearsAgo) continue;

        const accessionFormatted = accession.replace(/-/g, '');
        const edgarUrl = `${EDGAR_BASE}/Archives/edgar/data/${data.cik}/${accessionFormatted}/${recent.primaryDocument[i]}`;

        await prisma.secFiling.upsert({
          where: { accessionNumber: accession },
          update: {
            companyName: data.name || target.name,
            formType: form,
            filingDate,
            reportDate: safeDate(recent.reportDate[i]),
            primaryDoc: recent.primaryDocument[i] ?? null,
            description: recent.primaryDocDescription[i] ?? null,
            sic: data.sic || null,
            stateOfIncorp: data.stateOfIncorporation || null,
            fiscalYearEnd: data.fiscalYearEnd || null,
            url: edgarUrl,
            syncedAt: new Date(),
          },
          create: {
            cik: target.cik,
            companyName: data.name || target.name,
            formType: form,
            accessionNumber: accession,
            filingDate,
            reportDate: safeDate(recent.reportDate[i]),
            primaryDoc: recent.primaryDocument[i] ?? null,
            description: recent.primaryDocDescription[i] ?? null,
            sic: data.sic || null,
            stateOfIncorp: data.stateOfIncorporation || null,
            fiscalYearEnd: data.fiscalYearEnd || null,
            url: edgarUrl,
          },
        });

        companyFilings++;
        total++;
      }

      if (companyFilings > 0) {
        console.log(`[sec-sync] ${target.name}: ${companyFilings} filings`);
      }
    }

    console.log(`[sec-sync] total: ${total} filings`);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[sec-sync] DONE in ${elapsed}s`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[sec-sync] FAILED', err);
  process.exit(1);
});
