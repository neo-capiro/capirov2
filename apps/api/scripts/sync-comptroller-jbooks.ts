import { config as dotenvConfig } from 'dotenv';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ProgramElementWriterService } from '../src/program-element/program-element-writer.service.js';
import { serviceFromPeCode, readR1UrlFromText, citationKey, PE_CODE_REGEX } from '../src/program-element/jbook/jbook-extract.js';

/**
 * sync-comptroller-jbooks.ts
 *
 * Ingests DoD Comptroller budget justification books (J-books) to populate
 * Program Element coverage WITH page-level, citable provenance so users can
 * open the source exhibit at the exact page and screenshot it.
 *
 * Pipeline (this pass: R-1 master list):
 *   1. Read scripts/__config__/comptroller-document-urls.yaml -> top-level R-1 URL.
 *   2. Download the PDF (cached under tmp/jbooks/ by filename; re-runs reuse it).
 *   3. Deterministic extract via scripts/__tools__/extract_jbook_r1.py
 *      (pdfplumber). The R-1 is a clean tabular exhibit, so this is $0 (no
 *      Textract). Pages flagged `unparsed_pages` would be the Textract TABLES
 *      fallback target (none for FY2027 R-1).
 *   4. For each row: upsert ProgramElement (writer validates pe_code, quarantines
 *      bad ones) + write a ProgramElementSource citation:
 *        sourceUrl = R-1 PDF URL, pageNumber = row.page, docType = 'R',
 *        exhibitType = 'R-1'. Deep link: `${sourceUrl}#page=${pageNumber}`.
 *
 * Dry-run by default; pass --commit to write. --doc=r1 (default).
 */

dotenvConfig();

const execFileAsync = promisify(execFile);

interface R1Row {
  peCode: string;
  title: string;
  budgetActivity: string | null;
  lineNumber: string | null;
  page: number;
}

interface ExtractResult {
  docType: string;
  pageCount: number;
  rows: R1Row[];
  unparsed_pages: number[];
  stats: { rows: number; pages_with_rows: number };
  error?: string;
}

function readR1Url(yamlPath: string): string {
  return readR1UrlFromText(fs.readFileSync(yamlPath, 'utf-8'));
}

async function download(url: string, dest: string): Promise<void> {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return; // cache hit
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (capiro-jbook-sync)' } });
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

async function main() {
  const commit = process.argv.includes('--commit');
  const configPath = path.resolve('scripts/__config__/comptroller-document-urls.yaml');
  const extractor = path.resolve('scripts/__tools__/extract_jbook_r1.py');
  const url = readR1Url(configPath);
  const pdfPath = path.resolve('tmp/jbooks', path.basename(new URL(url).pathname));

  await download(url, pdfPath);

  const { stdout } = await execFileAsync('python', [extractor, pdfPath, '--doc-type', 'R'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const result = JSON.parse(stdout) as ExtractResult;
  if (result.error) throw new Error(`extractor error: ${result.error}`);

  const stats = {
    mode: commit ? 'COMMIT' : 'DRY_RUN',
    sourceUrl: url,
    pageCount: result.pageCount,
    extracted_rows: result.rows.length,
    unparsed_pages: result.unparsed_pages.length,
    pe_inserted: 0,
    pe_updated: 0,
    pe_quarantined: 0,
    provenance_written: 0,
  };

  const prisma = new PrismaService();
  await prisma.onModuleInit();
  const peWriter = new ProgramElementWriterService(prisma);

  try {
    // Dedupe rows by (peCode, page) so the same PE on the same page isn't
    // double-cited; the same PE on DIFFERENT pages keeps each citation.
    const seen = new Set<string>();
    for (const row of result.rows) {
      const { service, serviceCode } = serviceFromPeCode(row.peCode);

      if (commit) {
        const res = await peWriter.upsertProgramElement(
          {
            peCode: row.peCode,
            title: row.title,
            service: service ?? undefined,
            serviceCode: serviceCode ?? undefined,
            budgetActivity: row.budgetActivity ?? undefined,
            lineNumber: row.lineNumber ?? undefined,
            appropriationType: 'RDT&E',
            rDocUrl: url,
            raw: { jbook: 'R-1', fy: 2027, page: row.page },
          } as never,
          'dod_comptroller_r1_fy2027',
          0.95,
        );
        if (res.inserted) stats.pe_inserted++;
        else stats.pe_updated++;

        // Provenance only for PEs that passed validation (exist in table).
        const exists = await prisma.programElement.findUnique({ where: { peCode: row.peCode } });
        if (exists) {
          const key = `${row.peCode}|R|${row.page}`;
          if (!seen.has(key)) {
            seen.add(key);
            await prisma.programElementSource.upsert({
              where: {
                // unique (pe_code, doc_type, source_url, page_number)
                peCode_docType_sourceUrl_pageNumber: {
                  peCode: row.peCode,
                  docType: 'R',
                  sourceUrl: url,
                  pageNumber: row.page,
                },
              } as never,
              create: {
                peCode: row.peCode,
                docType: 'R',
                exhibitType: 'R-1',
                fy: 2027,
                sourceUrl: url,
                pageNumber: row.page,
                snippet: `${row.peCode} ${row.title} (BA ${row.budgetActivity ?? '?'})`,
                publisher: 'DoD Comptroller',
                confidence: 0.95,
              },
              update: { snippet: `${row.peCode} ${row.title} (BA ${row.budgetActivity ?? '?'})` },
            });
            stats.provenance_written++;
          }
        } else {
          stats.pe_quarantined++;
        }
      } else {
        // dry-run: just validate pe_code shape locally
        if (PE_CODE_REGEX.test(row.peCode)) {
          const key = citationKey(row.peCode, 'R', row.page);
          if (!seen.has(key)) { seen.add(key); stats.provenance_written++; }
        } else {
          stats.pe_quarantined++;
        }
      }
    }

    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await prisma.onModuleDestroy();
  }
}

main().catch((e) => { console.error('[sync-comptroller-jbooks] fatal', e?.stack || e); process.exit(1); });
