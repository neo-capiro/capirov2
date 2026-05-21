/**
 * Sync Federal Register documents into federal_register_document table.
 *
 *   pnpm --filter @capiro/api sync:federal-register
 *
 * Source: https://www.federalregister.gov/api/v1/ — no auth required.
 * Fetches all documents since 2021-01-01 (RULE, PROPOSED_RULE, NOTICE, PRESIDENTIAL_DOCUMENT).
 * Estimated: ~250K documents, ~4-6 hours.
 *
 * Upserts by document_number.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenvConfig();

const BASE_URL = 'https://www.federalregister.gov/api/v1/documents.json';
const START_DATE = '2021-01-01';
const PER_PAGE = 100;

interface FRAgency {
  name: string;
  [key: string]: unknown;
}

interface FRDocument {
  document_number: string;
  type: string;
  title: string;
  abstract: string | null;
  agencies: FRAgency[] | null;
  publication_date: string;
  comments_close_on: string | null;
  effective_on: string | null;
  docket_ids: string[] | null;
  cfr_references: { cfr_reference: string; [k: string]: unknown }[] | { title: number; part: number; [k: string]: unknown }[] | null;
  html_url: string | null;
  pdf_url: string | null;
  topics: string[] | null;
  significant: boolean | null;
}

interface FRResponse {
  count: number;
  next_page_url: string | null;
  results: FRDocument[];
}

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function normType(type: string): string {
  const map: Record<string, string> = {
    'Rule': 'RULE',
    'Proposed Rule': 'PROPOSED_RULE',
    'Notice': 'NOTICE',
    'Presidential Document': 'PRESIDENTIAL_DOCUMENT',
  };
  return map[type] ?? type.toUpperCase().replace(/\s+/g, '_');
}

function extractCfrRefs(raw: FRDocument['cfr_references']): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    if (typeof r === 'object' && r !== null) {
      if ('cfr_reference' in r && typeof r.cfr_reference === 'string') return r.cfr_reference;
      if ('title' in r && 'part' in r) return `${r.title} CFR ${r.part}`;
    }
    return String(r);
  }).filter(Boolean);
}

async function fetchPage(page: number): Promise<FRResponse | null> {
  const url = new URL(BASE_URL);
  url.searchParams.set('conditions[publication_date][gte]', START_DATE);
  url.searchParams.set('per_page', String(PER_PAGE));
  url.searchParams.set('page', String(page));
  url.searchParams.set('order', 'newest');
  url.searchParams.set('fields[]', 'document_number');
  url.searchParams.append('fields[]', 'type');
  url.searchParams.append('fields[]', 'title');
  url.searchParams.append('fields[]', 'abstract');
  url.searchParams.append('fields[]', 'agencies');
  url.searchParams.append('fields[]', 'publication_date');
  url.searchParams.append('fields[]', 'comments_close_on');
  url.searchParams.append('fields[]', 'effective_on');
  url.searchParams.append('fields[]', 'docket_ids');
  url.searchParams.append('fields[]', 'cfr_references');
  url.searchParams.append('fields[]', 'html_url');
  url.searchParams.append('fields[]', 'pdf_url');
  url.searchParams.append('fields[]', 'topics');
  url.searchParams.append('fields[]', 'significant');

  const MAX_RETRIES = 5;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      if (resp.status === 429) {
        const wait = Math.min(5000 * attempt, 60000);
        console.warn(`[fr-sync] 429 rate limited, waiting ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      return (await resp.json()) as FRResponse;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        console.error(`[fr-sync] page ${page} failed after ${MAX_RETRIES} attempts:`, err instanceof Error ? err.message : err);
        return null;
      }
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  return null;
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[fr-sync] starting Federal Register sync from', START_DATE);

  try {
    // Fetch first page to get total count.
    const firstPage = await fetchPage(1);
    if (!firstPage) throw new Error('Failed to fetch first page');

    const totalDocs = firstPage.count;
    const totalPages = Math.ceil(totalDocs / PER_PAGE);
    console.log(`[fr-sync] total documents: ${totalDocs.toLocaleString()}, pages: ${totalPages}`);

    let processed = 0;
    let upserted = 0;
    let errored = 0;

    const processPage = async (docs: FRDocument[]) => {
      for (const doc of docs) {
        try {
          if (!doc.document_number || !doc.publication_date) {
            errored++;
            continue;
          }
          const agencyNames = (doc.agencies ?? []).map((a) => a.name).filter(Boolean);
          const docketIds = (doc.docket_ids ?? []).filter(Boolean);
          const cfrRefs = extractCfrRefs(doc.cfr_references);
          const topics = (doc.topics ?? []).filter(Boolean);

          await prisma.federalRegisterDocument.upsert({
            where: { documentNumber: doc.document_number },
            update: {
              type: normType(doc.type),
              title: doc.title ?? '',
              abstract: doc.abstract ?? null,
              agencyNames,
              publicationDate: new Date(doc.publication_date),
              commentEndDate: safeDate(doc.comments_close_on),
              effectiveDate: safeDate(doc.effective_on),
              docketIds,
              cfrReferences: cfrRefs,
              htmlUrl: doc.html_url ?? null,
              pdfUrl: doc.pdf_url ?? null,
              topics,
              significantRule: doc.significant ?? false,
              syncedAt: new Date(),
            },
            create: {
              documentNumber: doc.document_number,
              type: normType(doc.type),
              title: doc.title ?? '',
              abstract: doc.abstract ?? null,
              agencyNames,
              publicationDate: new Date(doc.publication_date),
              commentEndDate: safeDate(doc.comments_close_on),
              effectiveDate: safeDate(doc.effective_on),
              docketIds,
              cfrReferences: cfrRefs,
              htmlUrl: doc.html_url ?? null,
              pdfUrl: doc.pdf_url ?? null,
              topics,
              significantRule: doc.significant ?? false,
            },
          });
          upserted++;
        } catch (err) {
          errored++;
          console.warn(`[fr-sync] skip doc ${doc.document_number}:`, err instanceof Error ? err.message : err);
        }
        processed++;
      }
    };

    // Process first page.
    await processPage(firstPage.results ?? []);
    console.log(`[fr-sync] page 1/${totalPages} — ${processed.toLocaleString()} processed`);

    // Process remaining pages.
    for (let page = 2; page <= totalPages; page++) {
      const data = await fetchPage(page);
      if (!data?.results?.length) {
        console.warn(`[fr-sync] empty results on page ${page}, stopping`);
        break;
      }
      await processPage(data.results);

      if (page % 50 === 0) {
        const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
        console.log(`[fr-sync] page ${page}/${totalPages} — ${processed.toLocaleString()} processed, ${elapsed}m elapsed`);
      }

      // Polite delay: 500ms between pages (~200 req/min, well under limits)
      await new Promise((r) => setTimeout(r, 500));
    }

    const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
    console.log(`[fr-sync] DONE — ${upserted.toLocaleString()} upserted, ${errored} errors, ${elapsed}m`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[fr-sync] FAILED', err);
  process.exit(1);
});
