import * as ExcelJS from 'exceljs';
import { normalizeName } from '../normalization/name-normalizer.js';
import { isValidPeCode } from '../../program-element/jbook/jbook-extract.js';
import { PersonRecordInput } from '../types.js';

export interface ImportStats {
  persons_inserted: number;
  persons_addSourceMentioned: number;
  pes_inserted: number;
  pe_years_inserted: number;
  quarantined_rows: number;
  spot_check_sample: Array<{ fullName: string; organization: string; directoryPage: string | null; section: string | null }>;
}

export interface PersonnelWriterLike {
  upsertPerson(
    record: PersonRecordInput,
    source: string,
    sourceUrl: string | undefined,
    snippet: string | undefined,
    observedAt: Date,
    confidence: number,
  ): Promise<{ inserted: boolean; person_id: string; mergedWith?: string }>;
  addSourceMention(
    personId: string,
    source: string,
    sourceUrl: string | undefined,
    snippet: string | undefined,
    observedAt: Date,
    confidence: number,
  ): Promise<boolean>;
  quarantine(rawRecord: unknown, reason: string, source: string): Promise<void>;
}

export interface ProgramElementWriterLike {
  upsertProgramElement(
    record: {
      peCode: string;
      service?: string | null;
      budgetActivity?: string | null;
      budgetActivityName?: string | null;
      lineNumber?: string | null;
      title: string;
      raw?: unknown;
    },
    source: string,
    sourceConfidence: number,
  ): Promise<{ inserted: boolean; pe_code: string }>;
  upsertProgramElementYear(
    record: { peCode: string; fy: number; request?: number | null; enacted?: number | null; raw?: unknown },
    source: string,
  ): Promise<{ inserted: boolean; changed: boolean }>;
  quarantine(rawRecord: unknown, reason: string, source: string): Promise<void>;
}

export interface ImportDeps {
  writer: PersonnelWriterLike;
  programElementWriter: ProgramElementWriterLike;
  existingPersonByKey?: Map<string, string>;
  // Optional: returns existing people as [nameKey, id] pairs so the importer can
  // pre-seed its dedup map and stay idempotent across re-runs (the writer runs
  // with a noOp matcher during import, so this map is the sole dedup gate).
  loadExistingByNameKey?: () => Promise<Array<[string, string]>>;
}

const OBSERVED_AT = new Date('2026-01-15T00:00:00Z');

function toRowObj(headers: string[], rowValues: ExcelJS.CellValue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < headers.length; i += 1) {
    const key = headers[i]?.trim();
    if (!key) continue;
    const value = cellToString(rowValues[i + 1]);
    out[key] = value;
  }
  return out;
}

function cellToString(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text.trim();
  if (typeof value === 'object' && 'result' in value) return cellToString(value.result as ExcelJS.CellValue);
  return String(value).trim();
}

function cleanLink(raw: string | undefined): string | undefined {
  const v = (raw ?? '').trim();
  if (!v) return undefined;
  const lower = v.toLowerCase();
  if (lower === 'no link found' || lower === 'no link' || lower === 'n/a' || lower === 'none') return undefined;
  if (lower.startsWith('mailto:')) return undefined;
  if (lower.startsWith('http://') || lower.startsWith('https://')) return v;
  return undefined;
}

function extractEmailDomain(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (!v) continue;
    const trimmed = v.trim().toLowerCase();
    if (!trimmed) continue;
    if (trimmed.includes('@')) {
      const parts = trimmed.split('@');
      const domain = parts[1]?.trim();
      if (domain) return domain;
      continue;
    }
    return trimmed;
  }
  return undefined;
}

function inferRoleFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('program executive officer') || t.includes(' peo')) return 'PEO';
  if (t.includes('deputy program executive officer') || t.includes(' dpeo')) return 'DPEO';
  if (t.includes('deputy program manager') || t.includes(' dpm')) return 'DPM';
  if (t.includes('program manager') || /\bpm\b/.test(t)) return 'PM';
  if (t.includes('procuring contracting officer') || t.includes(' pco')) return 'PCO';
  if (t.includes('contracting officer') || /\bko\b/.test(t)) return 'KO';
  if (t.includes('chief engineer') || /\bce\b/.test(t)) return 'CE';
  if (t.includes('technical director') || /\btd\b/.test(t)) return 'TD';
  if (t.includes('staff')) return 'STAFFER';
  return 'OTHER';
}

function inferServiceFromOrganization(org: string): string | undefined {
  const o = org.toLowerCase();
  if (o.includes('army')) return 'ARMY';
  if (o.includes('navy')) return 'NAVY';
  if (o.includes('air force')) return 'AF';
  if (o.includes('space force')) return 'SF';
  if (o.includes('marine')) return 'USMC';
  if (o.includes('darpa')) return 'DARPA';
  if (o.includes('congress') || o.includes('committee')) return 'CONGRESS';
  if (o.includes('omb') || o.includes('office of management and budget') || o.includes('osd')) return 'OSD';
  return undefined;
}

function mapOrgCodeToService(code: string): string | undefined {
  const c = code.trim().toUpperCase();
  if (c === 'A') return 'ARMY';
  if (c === 'N') return 'NAVY';
  if (c === 'F') return 'AF';
  if (c === 'S') return 'SF';
  if (c === 'M') return 'USMC';
  if (c === 'D') return 'OSD';
  return undefined;
}

function toBudgetActivityCode(activity: string): string | undefined {
  const digits = activity.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  return `06${digits.padStart(2, '0').slice(-2)}`;
}

function moneyThousandsToDollars(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 1000);
}

function personKey(fullName: string, organization: string, title: string): string {
  // Dedup key MUST match the DB's uniqueness (acquisition_personnel.nameKey),
  // otherwise the same human appearing across sheets/passes with a different
  // org/title string produces a different key, misses the in-memory map, and the
  // writer (which runs with a noOpMatcher during import) creates a duplicate row.
  // Key on nameKey alone — org/title are intentionally ignored here.
  void organization;
  void title;
  return normalizeName(fullName).nameKey;
}

function pickDeterministicSample<T>(items: T[], sampleSize: number): T[] {
  if (items.length <= sampleSize) return [...items];
  const out: T[] = [];
  let seed = 20260115;
  const arr = [...items];
  while (out.length < sampleSize && arr.length > 0) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const idx = seed % arr.length;
    out.push(arr.splice(idx, 1)[0]!);
  }
  return out;
}

function findSheet(workbook: ExcelJS.Workbook, candidates: string[]): ExcelJS.Worksheet {
  for (const name of candidates) {
    const ws = workbook.getWorksheet(name);
    if (ws) return ws;
  }
  throw new Error(`Worksheet not found. Tried: ${candidates.join(', ')}`);
}

async function processFullDirectory(
  ws: ExcelJS.Worksheet,
  deps: ImportDeps,
  stats: ImportStats,
  spotPool: Array<{ fullName: string; organization: string; directoryPage: string | null; section: string | null }>,
): Promise<void> {
  const headers = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) => cellToString(v));
  const map = deps.existingPersonByKey ?? new Map<string, string>();

  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const obj = toRowObj(headers, row.values as ExcelJS.CellValue[]);

    const fullName = obj['Name']?.trim() ?? '';
    const organization = obj['Organization']?.trim() ?? '';
    const title = obj['Title / Role']?.trim() ?? '';
    if (!fullName || !organization || !title) {
      if (fullName || organization || title) {
        stats.quarantined_rows += 1;
      }
      continue;
    }

    const emailDomain = extractEmailDomain(obj['Verified Email'], obj['Assumed Email']);
    const publicProfileUrl = cleanLink(obj['Profile / Bio Link']);
    const pePrimary = (obj['PE/BLI'] && isValidPeCode(obj['PE/BLI'])) ? obj['PE/BLI'] : undefined;

    const metadata = {
      salesTier: obj['Capiro Sales Tier'] || null,
      submissionRelevance: obj['Submission Relevance'] || null,
      decisionAuthority: obj['Decision Authority'] || null,
      whyMatters: obj['Why This Person Matters to Capiro'] || null,
      subjectArea: obj['Subject Matter Area'] || null,
      peTitle: obj['PE/BLI Title'] || null,
      alignmentConfidence: obj['Alignment Confidence'] || null,
      directorySection: obj['Section'] || null,
      directoryPage: obj['Page #'] || null,
    };

    const record: PersonRecordInput = {
      fullName,
      organization,
      title,
      role: inferRoleFromTitle(title),
      pePrimary,
      emailDomain,
      publicProfileUrl,
      service: inferServiceFromOrganization(organization),
      metadata,
    };

    const key = personKey(fullName, organization, title);
    const source = 'stanford_dow_directory_jan2026';
    const sourceUrl = publicProfileUrl;
    const snippet = obj['Why This Person Matters to Capiro'] || undefined;

    const existingId = map.get(key);
    if (existingId) {
      const added = await deps.writer.addSourceMention(existingId, source, sourceUrl, snippet, OBSERVED_AT, 0.85);
      if (added) stats.persons_addSourceMentioned += 1;
    } else {
      try {
        const result = await deps.writer.upsertPerson(record, source, sourceUrl, snippet, OBSERVED_AT, 0.85);
        map.set(key, result.person_id || result.mergedWith || '');
        if (result.inserted) stats.persons_inserted += 1;
        else stats.persons_addSourceMentioned += 1;
      } catch {
        stats.quarantined_rows += 1;
      }
    }

    spotPool.push({
      fullName,
      organization,
      directoryPage: obj['Page #'] || null,
      section: obj['Section'] || null,
    });
  }
}

async function processTier1(ws: ExcelJS.Worksheet, deps: ImportDeps, stats: ImportStats): Promise<void> {
  const headers = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) => cellToString(v));
  const map = deps.existingPersonByKey ?? new Map<string, string>();

  for (let r = 2; r <= ws.rowCount; r += 1) {
    const obj = toRowObj(headers, ws.getRow(r).values as ExcelJS.CellValue[]);
    const fullName = obj['Name']?.trim() ?? '';
    const organization = obj['Organization']?.trim() ?? '';
    const title = obj['Title / Role']?.trim() ?? '';
    if (!fullName || !organization || !title) continue;

    const key = personKey(fullName, organization, title);
    const sourceUrl = cleanLink(obj['Profile / Bio Link']);
    const snippet = obj['Why This Person Matters to Capiro'] || undefined;

    const existingId = map.get(key);
    if (existingId) {
      const added = await deps.writer.addSourceMention(existingId, 'stanford_dow_tier1', sourceUrl, snippet, OBSERVED_AT, 0.9);
      if (added) stats.persons_addSourceMentioned += 1;
      continue;
    }

    try {
      const res = await deps.writer.upsertPerson(
        {
          fullName,
          organization,
          title,
          role: inferRoleFromTitle(title),
          emailDomain: extractEmailDomain(obj['Email']),
          publicProfileUrl: sourceUrl,
          service: inferServiceFromOrganization(organization),
          metadata: {
            salesTier: obj['Capiro Sales Tier'] || null,
            section: obj['Section'] || null,
            directoryPage: obj['Page #'] || null,
            tier1Endorsed: true,
          },
        },
        'stanford_dow_tier1',
        sourceUrl,
        snippet,
        OBSERVED_AT,
        0.9,
      );
      map.set(key, res.person_id || res.mergedWith || '');
      if (res.inserted) stats.persons_inserted += 1;
      else stats.persons_addSourceMentioned += 1;
    } catch {
      stats.quarantined_rows += 1;
    }
  }
}

async function processCongressionalStaff(ws: ExcelJS.Worksheet, deps: ImportDeps, stats: ImportStats): Promise<void> {
  const headers = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) => cellToString(v));
  const map = deps.existingPersonByKey ?? new Map<string, string>();

  for (let r = 2; r <= ws.rowCount; r += 1) {
    const obj = toRowObj(headers, ws.getRow(r).values as ExcelJS.CellValue[]);
    const fullName = obj['Name']?.trim() ?? '';
    const organization = obj['Organization']?.trim() ?? '';
    const title = obj['Title / Role']?.trim() ?? '';
    if (!fullName || !organization || !title) continue;

    const key = personKey(fullName, organization, title);
    const sourceUrl = cleanLink(obj['Profile / Bio Link']);
    const snippet = obj['Why This Person Matters to Capiro'] || undefined;
    const domainOnly = extractEmailDomain(obj['Email']);
    const existingId = map.get(key);

    if (existingId) {
      const added = await deps.writer.addSourceMention(existingId, 'stanford_dow_congressional_staff_jan2026', sourceUrl, snippet, OBSERVED_AT, 0.95);
      if (added) stats.persons_addSourceMentioned += 1;
      continue;
    }

    try {
      const result = await deps.writer.upsertPerson(
        {
          fullName,
          service: 'CONGRESS',
          role: 'STAFFER',
          organization,
          title,
          emailDomain: domainOnly,
          publicProfileUrl: sourceUrl,
          metadata: {
            salesTier: obj['Capiro Sales Tier'] || null,
            submissionRelevance: obj['Submission Relevance'] || null,
            decisionAuthority: obj['Decision Authority'] || null,
            whyMatters: obj['Why This Person Matters to Capiro'] || null,
            subjectArea: obj['SASC/HASC Subject Area'] || obj['Subject Matter Area'] || null,
            directorySection: obj['Section'] || null,
            directoryPage: obj['Page #'] || null,
          },
        },
        'stanford_dow_congressional_staff_jan2026',
        sourceUrl,
        snippet,
        OBSERVED_AT,
        0.95,
      );
      map.set(key, result.person_id || result.mergedWith || '');
      if (result.inserted) stats.persons_inserted += 1;
      else stats.persons_addSourceMentioned += 1;
    } catch {
      stats.quarantined_rows += 1;
    }
  }
}

async function processProgramElements(ws: ExcelJS.Worksheet, deps: ImportDeps, stats: ImportStats): Promise<void> {
  let headerRowNum = 1;
  for (let r = 1; r <= Math.min(8, ws.rowCount); r += 1) {
    const vals = (ws.getRow(r).values as ExcelJS.CellValue[]).map((v) => cellToString(v));
    if (vals.includes('Account') && vals.includes('PE/BLI')) {
      headerRowNum = r;
      break;
    }
  }

  const headers = (ws.getRow(headerRowNum).values as ExcelJS.CellValue[]).slice(1).map((v) => cellToString(v));

  for (let r = headerRowNum + 1; r <= ws.rowCount; r += 1) {
    const obj = toRowObj(headers, ws.getRow(r).values as ExcelJS.CellValue[]);
    const peCode = obj['PE/BLI']?.trim() ?? '';
    const title = obj['Program Element/Budget Line Item (BLI) Title']?.trim() ?? '';
    if (!peCode || !title) continue;

    if (!isValidPeCode(peCode)) {
      stats.quarantined_rows += 1;
      await deps.programElementWriter.quarantine(obj, `Invalid pe_code: ${peCode}`, 'stanford_pe_directory_jan2026');
      continue;
    }

    const peResult = await deps.programElementWriter.upsertProgramElement(
      {
        peCode,
        service: mapOrgCodeToService(obj['Organization'] ?? ''),
        budgetActivity: toBudgetActivityCode(obj['Budget Activity'] ?? ''),
        budgetActivityName: obj['Budget Activity Title'] || null,
        lineNumber: obj['Line Number'] || null,
        title,
        raw: {
          account: obj['Account'] || null,
          accountTitle: obj['Account Title'] || null,
          classification: obj['Classification'] || null,
        },
      },
      'stanford_pe_directory_jan2026',
      0.85,
    );

    if (peResult.inserted) stats.pes_inserted += 1;

    const fy24Actuals = moneyThousandsToDollars(obj['FY 2024 Actuals'] || '');
    const fy25Enacted = moneyThousandsToDollars(obj['FY 2025 Enacted'] || '');
    const fy25Supplemental = moneyThousandsToDollars(obj['FY 2025 Supplemental'] || '');
    const fy25Total = moneyThousandsToDollars(obj['FY 2025 Total'] || '') ?? ((fy25Enacted ?? 0) + (fy25Supplemental ?? 0));
    const fy26Disc = moneyThousandsToDollars(obj['FY 2026 Disc Request'] || '');
    const fy26Recon = moneyThousandsToDollars(obj['FY 2026 Reconciliation Request'] || '');
    const fy26Total = moneyThousandsToDollars(obj['FY 2026 Total'] || '') ?? ((fy26Disc ?? 0) + (fy26Recon ?? 0));

    if (fy24Actuals !== null) {
      const result = await deps.programElementWriter.upsertProgramElementYear(
        { peCode, fy: 2024, enacted: fy24Actuals, raw: { source: 'stanford', field: 'FY 2024 Actuals' } },
        'stanford_pe_directory_jan2026',
      );
      if (result.inserted) stats.pe_years_inserted += 1;
    }

    if (fy25Total !== null) {
      const result = await deps.programElementWriter.upsertProgramElementYear(
        { peCode, fy: 2025, enacted: fy25Total, raw: { source: 'stanford', field: 'FY 2025 Total' } },
        'stanford_pe_directory_jan2026',
      );
      if (result.inserted) stats.pe_years_inserted += 1;
    }

    if (fy26Total !== null) {
      const result = await deps.programElementWriter.upsertProgramElementYear(
        { peCode, fy: 2026, request: fy26Total, raw: { source: 'stanford', field: 'FY 2026 Total' } },
        'stanford_pe_directory_jan2026',
      );
      if (result.inserted) stats.pe_years_inserted += 1;
    }
  }
}

export async function importStanfordDowDirectory(workbookPath: string, deps: ImportDeps): Promise<ImportStats> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);

  // Ensure a single shared dedup map across all sheets, and pre-seed it from the
  // DB so re-runs are idempotent (same person -> map hit -> addSourceMention, not
  // a duplicate insert). Keyed by nameKey to match DB uniqueness.
  if (!deps.existingPersonByKey) deps.existingPersonByKey = new Map<string, string>();
  if (deps.loadExistingByNameKey) {
    for (const [nameKey, id] of await deps.loadExistingByNameKey()) {
      if (!deps.existingPersonByKey.has(nameKey)) deps.existingPersonByKey.set(nameKey, id);
    }
  }

  const stats: ImportStats = {
    persons_inserted: 0,
    persons_addSourceMentioned: 0,
    pes_inserted: 0,
    pe_years_inserted: 0,
    quarantined_rows: 0,
    spot_check_sample: [],
  };

  const spotPool: Array<{ fullName: string; organization: string; directoryPage: string | null; section: string | null }> = [];

  const fullDirectory = findSheet(workbook, ['Full Directory']);
  const tier1 = findSheet(workbook, ['🔴 Tier 1 — Decision Makers', '�� Tier 1 — Decision Makers']);
  const congressional = findSheet(workbook, ['⚡ Congressional Staff']);
  const programElements = findSheet(workbook, ['Program Elements']);

  await processFullDirectory(fullDirectory, deps, stats, spotPool);
  await processTier1(tier1, deps, stats);
  await processCongressionalStaff(congressional, deps, stats);
  await processProgramElements(programElements, deps, stats);

  stats.spot_check_sample = pickDeterministicSample(spotPool, 10);
  return stats;
}
