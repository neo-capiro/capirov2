/**
 * Pure classifier for retiring stale old-DoW-directory acquisition-personnel.
 * No I/O — the reconcile script reads DB rows, asks this for a decision, and acts.
 *
 * Background: the original personnel load came from a spreadsheet generated from an
 * OLD DoW directory (sources `stanford_dow_*`, observed 2026-01-15). It was later
 * superseded by the updated DoW directory (`dow_directory_rev6_2026_06`, observed
 * 2026-06-03). But re-import is additive — it only ADDS a source mention, never
 * retires anyone — so people the new directory dropped still display as `active`.
 *
 * This decides who was "superseded by the new directory." It is deliberately
 * CONSERVATIVE: a person is superseded only if their ENTIRE provenance is the old
 * DoW-directory load. Any other source mention — the new directory, a congressional
 * roster, press/SAM/hearing/GAO ingest, a confirmed PE match, a user suggestion —
 * keeps them. So we never hide anyone the new directory re-asserts, and we never
 * touch the congressional-staff population the new directory does not re-cover.
 */

/** One-time, deprecated loads from the OLD DoW-directory spreadsheet (Jan 2026). */
export const DEPRECATED_DOW_DIRECTORY_SOURCES = [
  'stanford_dow_directory_jan2026',
  'stanford_dow_tier1',
] as const;

/**
 * A DIFFERENT population the updated DoW directory does NOT re-cover. Carved out of
 * supersede entirely — being stanford-sourced here does not make someone stale.
 */
export const OUT_OF_SCOPE_SOURCES = ['stanford_dow_congressional_staff_jan2026'] as const;

/** The authoritative replacement directory (presence here always keeps a person). */
export const CURRENT_DOW_DIRECTORY_SOURCE = 'dow_directory_rev6_2026_06';

const DEPRECATED = new Set<string>(DEPRECATED_DOW_DIRECTORY_SOURCES);

export interface PersonSourceLike {
  source: string;
}

export interface PersonStalenessInput {
  supersededAt: Date | string | null;
  sources: PersonSourceLike[];
}

export type PersonStalenessAction = 'supersede' | 'keep' | 'skip';

export interface PersonStalenessDecision {
  action: PersonStalenessAction;
  reason: string;
}

/**
 * Decide whether a person should be soft-superseded. `supersede` only when every
 * source mention is in the deprecated old-DoW-directory set; otherwise `keep`
 * (some current/other source vouches for them) or `skip` (already superseded / no
 * provenance to judge).
 */
export function classifyPersonStaleness(p: PersonStalenessInput): PersonStalenessDecision {
  if (p.supersededAt) return { action: 'skip', reason: 'already_superseded' };
  if (!p.sources || p.sources.length === 0) {
    return { action: 'skip', reason: 'no_source_mentions' };
  }

  const allFromDeprecatedDow = p.sources.every((s) => DEPRECATED.has(s.source));
  if (!allFromDeprecatedDow) {
    return { action: 'keep', reason: 'has_current_or_other_source' };
  }

  return { action: 'supersede', reason: 'old_dow_directory_only_absent_from_current' };
}

/** True iff the person carries a `stanford_dow_tier1` mention (surfaced separately
 * in dry-run output so a human can eyeball decision-maker supersedes before commit). */
export function isTier1(sources: PersonSourceLike[]): boolean {
  return sources.some((s) => s.source === 'stanford_dow_tier1');
}
