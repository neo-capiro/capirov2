/**
 * program-match-thresholds.ts — PURE, deterministic helpers for PE -> Program match
 * confidence tiers (plan §7 evidence table + thresholds). No DB, no NestJS, no I/O:
 * this is the single source of truth for "given a score + evidence tier, what is the
 * DEFAULT review status?" and is exhaustively unit-tested (table-driven).
 *
 * Hard rule (plan §7, entity-resolution discipline §5): a fuzzy/usage path is NEVER
 * auto-accepted. status='accepted' is only DERIVED when BOTH (a) score >= 0.90 AND
 * (b) the evidence tier is one of the OFFICIAL+EXACT tiers (an explicit PE number, an
 * exact project title, a government office page naming the program, etc.) or the
 * curated MDAP seed. Everything else lands as candidate/quarantined for human review.
 */

export type MatchStatus = 'accepted' | 'candidate' | 'quarantined' | 'rejected';

/**
 * Evidence tiers, strongest -> weakest (plan §7 + §13). The 'official+exact' subset
 * are the ONLY non-seed tiers that may carry an auto-accepted status when the score
 * also clears 0.90. 'mdap_curated' is the human-curated seed (always trusted).
 */
export type EvidenceTier =
  | 'mdap_curated' // curated MDAP seed (seed_curated_v1) — trusted, human-reviewed
  | 'exact_pe_number' // the source names the exact PE code
  | 'exact_project_title' // exact (normalized) project title match
  | 'r2a_office_named' // R-2A exhibit names the managing office/program
  | 'other_funding_link' // resolved P-1 line shared with a program's known lines
  | 'official_office_page' // government office page naming the program
  | 'sar_msar' // Selected Acquisition Report / Monthly SAR
  | 'sam_match' // SAM.gov usage
  | 'award_match' // USAspending award usage
  | 'press_release' // contractor/agency press release
  | 'news_only'; // news mention only

/**
 * The tiers that are BOTH official AND exact — eligible for the >=0.90 auto-accept
 * rule. 'mdap_curated' is handled separately (it is the curated seed, always accepted
 * by the seeder regardless of this set). Fuzzy/usage tiers are intentionally excluded.
 */
export const OFFICIAL_EXACT_TIERS: ReadonlySet<EvidenceTier> = new Set<EvidenceTier>([
  'exact_pe_number',
  'exact_project_title',
  'r2a_office_named',
  'official_office_page',
]);

/** Auto-accept lower bound (inclusive). Below this, never accepted from any path. */
export const ACCEPT_MIN = 0.9;
/** Candidate lower bound (inclusive): [0.70, 0.90) -> candidate. */
export const CANDIDATE_MIN = 0.7;
/** Quarantine lower bound (inclusive): [0.50, 0.70) -> quarantined. */
export const QUARANTINE_MIN = 0.5;

/** True when a tier is eligible for the official+exact auto-accept rule. */
export function isOfficialExactTier(tier: string): boolean {
  return OFFICIAL_EXACT_TIERS.has(tier as EvidenceTier);
}

/**
 * Derive the DEFAULT review status from a match's score + evidence tier, per the
 * plan thresholds:
 *   - score >= 0.90 AND (official+exact tier OR curated seed) -> 'accepted'
 *   - score >= 0.90 but NOT official+exact                    -> 'candidate' (needs review)
 *   - 0.70 <= score < 0.90                                    -> 'candidate'
 *   - 0.50 <= score < 0.70                                    -> 'quarantined'
 *   - score < 0.50                                            -> 'quarantined' (weak signal)
 *
 * NOTE: the curated MDAP seed sets status='accepted' explicitly (it is human-reviewed,
 * score 1.0, tier 'mdap_curated'); this helper agrees with that for completeness, but
 * machine/fuzzy callers MUST pass the real fuzzy tier so they can never reach 'accepted'.
 */
export function deriveMatchStatus(score: number, evidenceTier: string): MatchStatus {
  if (score >= ACCEPT_MIN && (evidenceTier === 'mdap_curated' || isOfficialExactTier(evidenceTier))) {
    return 'accepted';
  }
  if (score >= CANDIDATE_MIN) return 'candidate';
  // Everything below 0.70 is held back from the UI: 0.50-0.69 quarantined,
  // <0.50 quarantined + weakSignal (never surfaced).
  return 'quarantined';
}

/** True when a match is a weak signal (<0.50): stored, flagged, NEVER surfaced. */
export function isWeakSignal(score: number): boolean {
  return score < QUARANTINE_MIN;
}

/** Human-readable confidence band for the UI ('high' | 'medium' | 'low' | 'weak'). */
export function confidenceBand(score: number): 'high' | 'medium' | 'low' | 'weak' {
  if (score >= ACCEPT_MIN) return 'high';
  if (score >= CANDIDATE_MIN) return 'medium';
  if (score >= QUARANTINE_MIN) return 'low';
  return 'weak';
}
