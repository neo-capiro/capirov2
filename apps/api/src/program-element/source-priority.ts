/**
 * Source-priority helpers shared by the PE-year writer (canonical merge) and the
 * rebuild-from-log migration. One definition so the two paths can never disagree
 * about which source wins a field or how a source is labeled for the UI.
 */
import { SOURCE_PRIORITY } from './types.js';

// Human-readable provenance shown in the FY drawer's "Source" column and the
// timeline tooltip, keyed by the base source (service / _fyNN suffixes stripped).
export const SOURCE_LABEL: Record<string, string> = {
  conference_report: 'NDAA conference',
  hac_d_report: 'HAC-D report',
  sac_d_report: 'SAC-D report',
  hasc_report: 'HASC report',
  sasc_report: 'SASC report',
  r_doc: "President's Budget (R-2)",
  p_doc: "President's Budget (P-1)",
  public_law: 'Enacted public law',
  usaspending: 'USAspending',
  bill_text: 'Bill text',
  fixture: 'Seed fixture',
};

/**
 * Resolve a (possibly suffixed) source tag to its canonical priority key. Tags
 * carry service and/or fiscal-year suffixes — `r_doc_army`, `hasc_report_fy27`,
 * `p_doc_navy_fy27` — so we match the SOURCE_PRIORITY key the tag equals or is
 * prefixed by. No base key is a prefix of another, so the match is unambiguous.
 */
export function sourceBaseKey(source: string): string {
  return SOURCE_PRIORITY.find((key) => source === key || source.startsWith(`${key}_`)) ?? source;
}

/** Priority rank — lower index = higher priority. Unknown sources sort last. */
export function sourceRank(source: string): number {
  const idx = SOURCE_PRIORITY.findIndex((key) => source === key || source.startsWith(`${key}_`));
  return idx === -1 ? SOURCE_PRIORITY.length : idx;
}

/** Display label for a source tag (falls back to the resolved base key). */
export function sourceLabel(source: string): string {
  const base = sourceBaseKey(source);
  return SOURCE_LABEL[base] ?? base;
}
