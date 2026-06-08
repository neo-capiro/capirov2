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

// ---------------------------------------------------------------------------
// PersonRole staleness (plan §8: people hang off OFFICES and ROLES).
// ---------------------------------------------------------------------------

/**
 * A `person_role` asserts that, as of `observedAt`, a person held a role on an
 * office/program. Roles are NOT re-asserted on every sync — they decay. If a role
 * has not been re-observed for longer than the staleness threshold, we mark it
 * stale so downstream consumers stop surfacing it (e.g. on recommendation
 * surfaces). This is a pure time-based decision; the reconcile script supplies a
 * single captured `now` so the function never reads the clock itself.
 */
export interface RoleStalenessInput {
  observedAt: Date | string | null;
  staleAt: Date | string | null;
  /** Caller-supplied clock — keeps this function pure/testable. */
  now: Date;
  /** Days of no re-assertion before a role is considered stale. */
  thresholdDays?: number;
}

export type RoleStalenessAction = 'mark_stale' | 'keep' | 'skip';

export interface RoleStalenessDecision {
  action: RoleStalenessAction;
  reason: string;
}

/** Default re-assertion window before a role decays (days). */
export const DEFAULT_ROLE_STALENESS_THRESHOLD_DAYS = 180;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Coerce a Date | ISO string | null into a Date (or null). */
function toDateOrNull(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Decide whether a `person_role` should be marked stale.
 *
 *   - no `observedAt`            -> skip       ('no observed_at')
 *   - `staleAt` already set      -> skip       ('already stale')  [idempotent]
 *   - age STRICTLY > threshold   -> mark_stale ('observed_at older than <n>d ...')
 *   - otherwise                  -> keep       ('fresh')
 *
 * The threshold is a STRICT greater-than at the day boundary: a role observed
 * exactly `thresholdDays` ago is still kept; one day older is marked stale.
 */
export function classifyRoleStaleness(input: RoleStalenessInput): RoleStalenessDecision {
  const thresholdDays = input.thresholdDays ?? DEFAULT_ROLE_STALENESS_THRESHOLD_DAYS;

  const observedAt = toDateOrNull(input.observedAt);
  if (!observedAt) return { action: 'skip', reason: 'no observed_at' };

  if (toDateOrNull(input.staleAt)) return { action: 'skip', reason: 'already stale' };

  const ageDays = (input.now.getTime() - observedAt.getTime()) / MS_PER_DAY;
  if (ageDays > thresholdDays) {
    return {
      action: 'mark_stale',
      reason: `observed_at older than ${thresholdDays}d without re-assertion`,
    };
  }

  return { action: 'keep', reason: 'fresh' };
}
