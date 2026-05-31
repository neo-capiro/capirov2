import { Injectable, Logger } from '@nestjs/common';
import { isValidPeCode } from '../jbook/jbook-extract.js';
import { ProgramElementWriterService } from '../program-element-writer.service.js';

/**
 * HASC / SASC committee-report parser (Step 22).
 *
 * Parses NDAA committee reports (House HRPT / Senate SRPT, Armed Services) for
 * per-PE budget marks and feeds them to the program-element writer, which owns
 * pe_code validation→quarantine, source-priority resolution, delta detection,
 * and IntelligenceChange emission.
 *
 * Consistent with the rest of the PE ingestion pipeline (R-1/R-2 J-books): the
 * heavy PDF→rows extraction is deterministic and done offline (pdfplumber tool,
 * scripts/__tools__/extract_armed_services_report.py) producing a committed JSON
 * artifact; this service is the pure parser + DB loader. No Textract/LLM in the
 * runtime path (see SKILL note + step summary for the rationale).
 */

export type Chamber = 'HASC' | 'SASC';

/** A committee mark for one PE in one fiscal year, as extracted from a report. */
export interface ArmedServicesMarkRecord {
  peCode: string;
  fy: number;
  /** President's request in dollars (optional — reports don't always restate it). */
  request: number | null;
  /** The committee's recommended/authorized mark in dollars. */
  mark: number | null;
  /** Optional plus-up / mark explanation text. */
  explanation: string | null;
}

/** One pre-extracted tabular row from the offline pdfplumber tool. */
export interface ExtractedReportRow {
  peCode?: string | null;
  fy?: number | string | null;
  request?: number | string | null;
  mark?: number | string | null;
  explanation?: string | null;
  [key: string]: unknown;
}

export interface ParseOptions {
  /** Fiscal year the report authorizes (e.g. 2027 for an FY2027 NDAA report). */
  fy: number;
}

export interface LoadResult {
  source: string;
  rowsSeen: number;
  upserted: number;
  changed: number;
  quarantined: number;
}

// PE code: 7 digits + service letter (+ optional suffix). Same canon as jbook.
const PE_TOKEN = /\b([0-9]{7}[A-Z][A-Z0-9]*)\b/;
// A dollar amount in a mark column: 1,234 / 1234 / (500) negative / 12.5 (thousands).
const AMOUNT = /\(?-?\$?[\d,]+(?:\.\d+)?\)?/g;

/** Normalize a money token to a number in dollars. Parenthesized = negative. */
export function parseAmount(token: string | number | null | undefined): number | null {
  if (token === null || token === undefined) return null;
  if (typeof token === 'number') return Number.isFinite(token) ? token : null;
  const t = token.trim();
  if (!t) return null;
  const negative = /^\(.*\)$/.test(t);
  const cleaned = t.replace(/[(),$\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Parse raw committee-report text into mark records. Scans line-by-line; a line
 * is a PE row when it starts with (or contains as its first token) a valid PE
 * code followed by one or more amount columns. By convention the LAST amount on
 * the line is the committee recommendation (mark); when two amounts are present
 * the first is treated as the request.
 */
export function parseReportText(text: string, opts: ParseOptions): ArmedServicesMarkRecord[] {
  const out: ArmedServicesMarkRecord[] = [];
  if (!text) return out;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const peMatch = line.match(PE_TOKEN);
    if (!peMatch) continue;
    // Require the PE code to be at the start of the row (table first column),
    // not merely mentioned mid-sentence in narrative prose.
    if (line.indexOf(peMatch[1]!) > 8) continue;

    const peCode = peMatch[1]!.toUpperCase();
    const afterPe = line.slice(line.indexOf(peMatch[1]!) + peMatch[1]!.length);
    const amounts = (afterPe.match(AMOUNT) ?? [])
      .map((a) => parseAmount(a))
      .filter((n): n is number => n !== null);

    if (amounts.length === 0) continue;

    const mark = amounts[amounts.length - 1] ?? null;
    const request = amounts.length >= 2 ? amounts[0]! : null;
    // Explanation: trailing non-numeric prose after the last amount, if any.
    const explanation = extractExplanation(afterPe);

    out.push({ peCode, fy: opts.fy, request, mark, explanation });
  }

  return dedupeByPe(out);
}

/** Parse already-tabular rows (from the offline pdfplumber extractor JSON). */
export function parseExtractedRows(rows: ExtractedReportRow[], opts: ParseOptions): ArmedServicesMarkRecord[] {
  const out: ArmedServicesMarkRecord[] = [];
  for (const r of rows) {
    const peCode = (r.peCode ?? '').toString().trim().toUpperCase();
    if (!peCode) continue;
    const fy = r.fy !== null && r.fy !== undefined && r.fy !== '' ? Number(r.fy) : opts.fy;
    out.push({
      peCode,
      fy: Number.isFinite(fy) ? fy : opts.fy,
      request: parseAmount(r.request ?? null),
      mark: parseAmount(r.mark ?? null),
      explanation: r.explanation ? String(r.explanation) : null,
    });
  }
  return dedupeByPe(out);
}

function extractExplanation(afterPe: string): string | null {
  // Strip leading amounts/whitespace; keep any trailing descriptive text.
  const stripped = afterPe.replace(AMOUNT, ' ').replace(/\s+/g, ' ').trim();
  return stripped.length > 2 ? stripped : null;
}

/** Last-wins dedupe on peCode within a single report. */
function dedupeByPe(records: ArmedServicesMarkRecord[]): ArmedServicesMarkRecord[] {
  const byPe = new Map<string, ArmedServicesMarkRecord>();
  for (const r of records) byPe.set(r.peCode, r);
  return Array.from(byPe.values());
}

/** Build the writer source tag, e.g. hasc_report_fy27 / sasc_report_fy27. */
export function reportSource(chamber: Chamber, fy: number): string {
  const fy2 = String(fy).slice(-2);
  return `${chamber.toLowerCase() === 'hasc' ? 'hasc' : 'sasc'}_report_fy${fy2}`;
}

@Injectable()
export class ArmedServicesReportParserService {
  private readonly logger = new Logger(ArmedServicesReportParserService.name);

  constructor(private readonly writer: ProgramElementWriterService) {}

  /**
   * Load parsed mark records into the DB via the writer. The writer validates
   * pe_code (quarantining bad ones), applies source priority, computes the year
   * delta, and emits an IntelligenceChange when a watched PE's value changes.
   * Bad pe_codes are counted here so the run summary is accurate.
   */
  async load(records: ArmedServicesMarkRecord[], chamber: Chamber, fy: number): Promise<LoadResult> {
    const source = reportSource(chamber, fy);
    const markField = chamber === 'HASC' ? 'hascMark' : 'sascMark';
    let upserted = 0;
    let changed = 0;
    let quarantined = 0;

    for (const rec of records) {
      if (!isValidPeCode(rec.peCode)) {
        // Delegate quarantine to the writer (single quarantine path / metrics).
        await this.writer.quarantine(rec, `Invalid pe_code in ${source}: ${rec.peCode}`, source);
        quarantined += 1;
        continue;
      }

      const result = await this.writer.upsertProgramElementYear(
        {
          peCode: rec.peCode,
          fy: rec.fy,
          request: rec.request,
          [markField]: rec.mark,
          notes: rec.explanation,
          raw: rec,
        },
        source,
      );
      upserted += 1;
      if (result.changed) changed += 1;
    }

    this.logger.log(`${source}: ${upserted} upserted, ${changed} changed, ${quarantined} quarantined`);
    return { source, rowsSeen: records.length, upserted, changed, quarantined };
  }
}
