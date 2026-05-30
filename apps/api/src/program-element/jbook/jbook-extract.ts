/**
 * Pure helpers for the DoD Comptroller J-book (R-1/P-1) sync. Kept in src/ (not
 * scripts/) so they are unit-tested by the standard jest spec matcher and
 * importable by scripts/sync-comptroller-jbooks.ts.
 */

export interface JbookServiceInfo {
  service: string | null;
  serviceCode: string | null;
}

const SERVICE_DESIGNATOR: Record<string, string> = {
  A: 'ARMY',
  N: 'NAVY',
  F: 'AF',
  M: 'USMC',
  S: 'SF',
  E: 'DARPA',
  D: 'DW',
  C: 'DW',
  G: 'DW',
  T: 'DW',
  B: 'DW',
};

/** Derive service + designator from the 8th char of an RDT&E PE code. */
export function serviceFromPeCode(peCode: string): JbookServiceInfo {
  const c = peCode[7]?.toUpperCase();
  if (!c) return { service: null, serviceCode: null };
  return { service: SERVICE_DESIGNATOR[c] ?? null, serviceCode: c };
}

/**
 * Extract top_level_summaries.r1.url from the comptroller YAML config without a
 * yaml dependency. The config is simple and stable; we anchor on the `r1:` block.
 */
export function readR1UrlFromText(text: string): string {
  const lines = text.split(/\r?\n/);
  let inR1 = false;
  for (const line of lines) {
    if (/^\s{2}r1:\s*$/.test(line)) {
      inR1 = true;
      continue;
    }
    if (inR1) {
      const m = line.match(/^\s*url:\s*(\S+)/);
      if (m) return m[1]!;
      if (/^\s{2}\w/.test(line)) break; // left the r1 block
    }
  }
  throw new Error('Could not find top_level_summaries.r1.url in comptroller config');
}

/** Page-anchored citation users can open + screenshot. */
export function jbookDeepLink(sourceUrl: string, pageNumber: number): string {
  return `${sourceUrl}#page=${pageNumber}`;
}

/** Stable dedup key for one PE citation on one page of one doc-type. */
export function citationKey(peCode: string, docType: string, pageNumber: number): string {
  return `${peCode}|${docType}|${pageNumber}`;
}

export const PE_CODE_REGEX = /^[0-9]{7}[A-Z]$/;
