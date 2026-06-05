/**
 * FARA enrichment engine — pure functions for turning a FARA "foreign
 * principals" bulk feed (JSON or CSV) into per-registration enrichment, and for
 * deciding how to merge that into an existing FaraRegistration row WITHOUT
 * clobbering data the base sync-fara directory feed cannot provide.
 *
 * Why this lives here (src/) and not in the script: it's the only part that can
 * be unit-tested. scripts/sync-fara-enrichment.ts is the thin I/O orchestrator
 * (fetch + prisma upsert); everything decision-shaped is here and covered by
 * fara-enrichment.spec.ts.
 *
 * Context: sync-fara.ts ingests efile.fara.gov/api/v1/Registrants/json/Active,
 * which is the active-registrant DIRECTORY ONLY — no foreign principal, country,
 * or termination data (it stores FP_UNSPECIFIED as a sentinel). The foreign
 * principal exhibits are not exposed by that JSON API, so enrichment consumes
 * the FARA BULK dataset (one row per registrant x foreign principal). This
 * module is source-shape-agnostic: it accepts the bulk feed as JSON rows or CSV
 * text and normalizes either.
 */

/** Sentinel written by sync-fara when no real foreign principal is known. */
export const FP_UNSPECIFIED = '(not specified in FARA active-registrants feed)';

/** One raw foreign-principal row from the bulk feed (a registrant may have many). */
export interface ForeignPrincipalRecord {
  registrationNumber: string;
  foreignPrincipalName: string | null;
  country: string | null;
  status?: string | null;
  terminationDate?: string | null;
}

/** Collapsed enrichment for a single registration (many FP rows -> one row). */
export interface RegistrationEnrichment {
  registrationNumber: string;
  /** Distinct foreign principals, de-duped and joined for the single-column schema. */
  foreignPrincipal: string;
  /** Primary country (most frequent, then first seen); null if none given. */
  country: string | null;
  status: string | null;
  terminationDate: string | null;
}

/** The subset of FaraRegistration the merge reads to decide what to write. */
export interface ExistingRegistration {
  foreignPrincipal: string | null;
  country: string | null;
  status: string | null;
  terminationDate: Date | string | null;
}

/** Fields the enrichment would write; null means "no change — skip this row". */
export interface EnrichmentUpdate {
  foreignPrincipal: string;
  country: string | null;
  status: string | null;
  terminationDate: string | null;
}

function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** True when a stored foreignPrincipal carries no real value (null/empty/sentinel). */
export function isSentinel(value: string | null | undefined): boolean {
  const s = clean(value);
  return s === null || s === FP_UNSPECIFIED;
}

/**
 * Map a loose record (keys vary by source) to a ForeignPrincipalRecord. Accepts
 * the common FARA header variants (snake, PascalCase, spaced) case-insensitively.
 * Returns null if there is no registration number to key on.
 */
export function normalizeRecord(rec: Record<string, unknown>): ForeignPrincipalRecord | null {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    lower[k.toLowerCase().replace(/[\s_]+/g, '')] = v;
  }
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const hit = clean(lower[key.toLowerCase().replace(/[\s_]+/g, '')]);
      if (hit !== null) return hit;
    }
    return null;
  };
  const registrationNumber = pick(
    'registrationnumber',
    'regnumber',
    'registrant',
    'registrationno',
  );
  if (!registrationNumber) return null;
  return {
    registrationNumber,
    foreignPrincipalName: pick('foreignprincipal', 'foreignprincipalname', 'fpname', 'principal'),
    country: pick('foreignprincipalcountry', 'country', 'fpcountry'),
    status: pick('status', 'registrationstatus'),
    terminationDate: pick('terminationdate', 'datestamped', 'enddate'),
  };
}

/**
 * Parse a bulk feed into normalized rows. Handles a JSON array, the eFile
 * `{ WRAPPER: { ROW: [...] } }` envelope shape, or CSV text. Unknown/garbage
 * input yields an empty array (never throws on shape).
 */
export function parseForeignPrincipalFeed(
  raw: string,
  contentType?: string,
): ForeignPrincipalRecord[] {
  const text = (raw ?? '').trim();
  if (!text) return [];
  const looksJson =
    (contentType ?? '').includes('json') || text.startsWith('[') || text.startsWith('{');
  if (looksJson) {
    try {
      const data = JSON.parse(text);
      const rows = extractJsonRows(data);
      return rows.map(normalizeRecord).filter((r): r is ForeignPrincipalRecord => r !== null);
    } catch {
      /* fall through to CSV */
    }
  }
  return parseCsv(text)
    .map(normalizeRecord)
    .filter((r): r is ForeignPrincipalRecord => r !== null);
}

function extractJsonRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    // eFile shape: { SOME_WRAPPER: { ROW: [...] } } or { ROW: [...] } or { results: [...] }
    for (const key of Object.keys(obj)) {
      const inner = obj[key];
      if (Array.isArray(inner)) return inner as Record<string, unknown>[];
      if (inner && typeof inner === 'object') {
        const row = (inner as Record<string, unknown>).ROW;
        if (Array.isArray(row)) return row as Record<string, unknown>[];
        if (row && typeof row === 'object') return [row as Record<string, unknown>];
      }
    }
  }
  return [];
}

/** Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, CRLF). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      /* swallow; \n closes the row */
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((cell) => cell.trim().length))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, idx) => {
        obj[h] = (r[idx] ?? '').trim();
      });
      return obj;
    });
}

/**
 * Collapse many foreign-principal rows into one enrichment per registration.
 * - foreignPrincipal: distinct names (case-insensitive), original order, joined "; ".
 * - country: most frequent non-null; ties broken by first seen.
 * - status/terminationDate: first non-null seen.
 * Rows whose only FP name is empty contribute country/status but not a name.
 */
export function groupEnrichments(
  rows: ForeignPrincipalRecord[],
): Map<string, RegistrationEnrichment> {
  const byReg = new Map<string, ForeignPrincipalRecord[]>();
  for (const r of rows) {
    const key = r.registrationNumber.trim();
    if (!key) continue;
    (byReg.get(key) ?? byReg.set(key, []).get(key)!).push(r);
  }

  const out = new Map<string, RegistrationEnrichment>();
  for (const [reg, recs] of byReg) {
    const names: string[] = [];
    const seenName = new Set<string>();
    const countryCounts = new Map<string, number>();
    let status: string | null = null;
    let terminationDate: string | null = null;
    for (const r of recs) {
      const name = clean(r.foreignPrincipalName);
      if (name) {
        const dedupKey = name.toLowerCase();
        if (!seenName.has(dedupKey)) {
          seenName.add(dedupKey);
          names.push(name);
        }
      }
      const country = clean(r.country);
      if (country) countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
      if (!status && clean(r.status)) status = clean(r.status);
      if (!terminationDate && clean(r.terminationDate)) terminationDate = clean(r.terminationDate);
    }
    let country: string | null = null;
    let best = 0;
    for (const [c, n] of countryCounts) {
      if (n > best) {
        best = n;
        country = c;
      }
    }
    out.set(reg, {
      registrationNumber: reg,
      foreignPrincipal: names.length ? names.join('; ') : FP_UNSPECIFIED,
      country,
      status,
      terminationDate,
    });
  }
  return out;
}

/**
 * Decide what to write for one registration. Returns null (skip) when there is
 * nothing to add. Preserves prior real enrichment: an existing real
 * foreignPrincipal is only overwritten when force=true; country/status/
 * terminationDate are filled only when currently empty (unless force).
 */
export function resolveEnrichmentUpdate(
  existing: ExistingRegistration | null,
  enrichment: RegistrationEnrichment,
  opts: { force?: boolean } = {},
): EnrichmentUpdate | null {
  const force = opts.force === true;
  const hasRealFp = enrichment.foreignPrincipal !== FP_UNSPECIFIED;

  const existingFpReal = existing ? !isSentinel(existing.foreignPrincipal) : false;
  // Foreign principal: take the new real value if we don't already have one, or if forcing.
  let foreignPrincipal: string | null = null;
  if (hasRealFp && (force || !existingFpReal)) {
    foreignPrincipal = enrichment.foreignPrincipal;
  }

  const existingCountry = existing ? clean(existing.country) : null;
  const country = enrichment.country && (force || !existingCountry) ? enrichment.country : null;

  const existingStatus = existing ? clean(existing.status) : null;
  const status = enrichment.status && (force || !existingStatus) ? enrichment.status : null;

  const existingTerm = existing && existing.terminationDate ? existing.terminationDate : null;
  const terminationDate =
    enrichment.terminationDate && (force || !existingTerm) ? enrichment.terminationDate : null;

  if (
    foreignPrincipal === null &&
    country === null &&
    status === null &&
    terminationDate === null
  ) {
    return null; // nothing to change
  }
  return {
    // Keep the existing real FP if we're not changing it (so callers can write a full row).
    foreignPrincipal:
      foreignPrincipal ??
      (existingFpReal ? (existing!.foreignPrincipal as string) : FP_UNSPECIFIED),
    country,
    status,
    terminationDate,
  };
}
