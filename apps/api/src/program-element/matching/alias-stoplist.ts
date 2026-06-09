/**
 * alias-stoplist.ts — generic DoD accounting/category labels that must NEVER be
 * used as PE↔Program match evidence.
 *
 * Labels like "Congressional Adds", "Program-Wide Support", "SBIR/STTR", and
 * "Management Support" appear VERBATIM under dozens of unrelated PEs/programs. If
 * one becomes a program alias, every PE/project whose title contains that text
 * trigram-matches it at ~1.00 — linking unrelated MDAPs to a single PE (the
 * classic false positive, e.g. H-1 + Trident II + E-2D all "matching" one PE via
 * a shared "Congressional Adds" line).
 *
 * Applied at TWO points:
 *   1. Alias creation/seeding — these are rejected so they never enter program_alias.
 *   2. The matcher — skips any alias OR PE/project title that is generic (defense in
 *      depth for aliases that predate this guard, and for generic PE titles).
 *
 * Inputs are the normalizeAlias() form: UPPER-CASE, punctuation→space, collapsed.
 *
 * SAFETY: matching is deliberately conservative — single ambiguous words (COMMON,
 * ENTERPRISE) match ONLY as the whole string, and prefixes require a token
 * boundary, so real programs like SBIRS (Space-Based IR) or COMMON MISSILE WARNING
 * SYSTEM are NOT caught. See alias-stoplist.spec.ts.
 */

/** Generic ONLY when they are the entire normalized label. */
const GENERIC_EXACT: ReadonlySet<string> = new Set<string>([
  'MISCELLANEOUS', 'MISC', 'OTHER', 'VARIOUS', 'CLASSIFIED', 'CLASSIFIED PROGRAMS',
  'COMMON', 'ENTERPRISE', 'GENERAL', 'SUPPORT', 'OVERHEAD', 'UNDISTRIBUTED',
  'TBD', 'PENDING', 'ADJUSTMENTS', 'TRANSFER', 'TRANSFERS', 'ITEMS UNDISTRIBUTED',
  'SBIR', 'STTR', 'SBIR STTR',
]);

/**
 * Generic as the whole label OR as a leading token group (require a trailing
 * space so SBIRS / COMMON-X are not caught). Plurals listed explicitly.
 */
const GENERIC_PREFIXES: readonly string[] = [
  'CONGRESSIONAL ADD', 'CONGRESSIONAL ADDS', 'CONGRESSIONAL INTEREST',
  'CONGRESSIONAL DIRECTED', 'CONGRESSIONALLY DIRECTED',
  'PROGRAM WIDE', 'PROGRAMWIDE', 'PROGRAM MANAGEMENT', 'PROGRAM ADMINISTRATION',
  'MANAGEMENT SUPPORT', 'MISSION SUPPORT', 'GENERAL SUPPORT',
  'STUDIES AND ANALYSIS', 'STUDIES ANALYSIS',
  'SMALL BUSINESS INNOVATION', 'SMALL BUSINESS INNOVATIVE',
  'CROSS PROGRAM', 'CROSS SERVICE',
];

/**
 * True when a normalized alias / title is a generic accounting category that must
 * not be used as match evidence. Empty/whitespace counts as generic (unusable).
 */
export function isGenericAlias(normalized: string | null | undefined): boolean {
  const s = (normalized ?? '').trim();
  if (!s) return true;
  if (GENERIC_EXACT.has(s)) return true;
  return GENERIC_PREFIXES.some((p) => s === p || s.startsWith(p + ' '));
}
