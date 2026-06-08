/**
 * Step 2.3 — Client ⇄ Program-Element (PE) relevance scoring (heuristic v2).
 *
 * PURE module: no DB, no NestJS, no I/O. The DB-fetching relevance SERVICE (a
 * later chunk) gathers raw signal facts per (client, PE) pair and calls these
 * per-path scorers, then `combineRelevance` to fold the paths into a single
 * 0..1 relevance score with supporting evidence.
 *
 * The weights here are deliberately simple, named constants — the accuracy
 * harness (Step 4.1) will tune them against labelled data, so the service and
 * tests reference the exported constants rather than hard-coded literals.
 */

/** The distinct evidence paths by which a client can be relevant to a PE. */
export type RelevancePath =
  | 'capability_pe_direct' // client capability explicitly lists this PE number — strongest
  | 'capability_keyword' // capability keywords/expanded-tags match PE title/mission/project text
  | 'prior_award' // client (by UEI/name) holds a federal award on this PE / program
  | 'facility_district' // a client facility sits in a congressional district with awards on this PE
  | 'ecosystem'; // client maps to a performer/awardee on the PE

export interface PathResult {
  path: RelevancePath;
  score: number;
  evidence: string[];
}

// ── Per-path weights (heuristic v2) ──────────────────────────────────────────

/** Explicit, government-grade PE match: a client capability names this PE. */
export const PE_DIRECT_SCORE = 1.0;

/** Base weight for a prior federal award on this PE (awardCount >= 1). */
export const PRIOR_AWARD_BASE_SCORE = 0.8;
/** Additional weight when the client has multiple (>= 3) prior awards. */
export const PRIOR_AWARD_VOLUME_BONUS = 0.1;
/** Award count at/above which the volume bonus applies. */
export const PRIOR_AWARD_VOLUME_THRESHOLD = 3;
/** Hard cap on the prior-award path score (base + bonus must not exceed this). */
export const PRIOR_AWARD_MAX_SCORE = 0.9;

/** A client facility sits in a district with awards on this PE. */
export const FACILITY_DISTRICT_SCORE = 0.6;

/** The client maps to a performer/awardee in the PE's ecosystem. */
export const ECOSYSTEM_SCORE = 0.5;

// ── Combination tuning ───────────────────────────────────────────────────────

/** A path counts as a "distinct strong path" for the diversity bonus at/above this score. */
export const STRONG_PATH_FLOOR = 0.3;
/** Per extra distinct strong path beyond the first. */
export const DIVERSITY_STEP = 0.05;
/** Upper bound on the diversity bonus regardless of how many strong paths corroborate. */
export const MAX_DIVERSITY_BONUS = 0.2;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Clamp a number into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Round to 2 decimal places, avoiding binary-float drift (e.g. 0.30000000004). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Format a USD amount compactly for evidence strings (e.g. $1.2M, $850K, $4.2B). */
function formatUsd(amount: number): string {
  const n = Math.max(0, amount);
  if (n >= 1_000_000_000) return `$${round2(n / 1_000_000_000)}B`;
  if (n >= 1_000_000) return `$${round2(n / 1_000_000)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

// ── Per-path scorers ─────────────────────────────────────────────────────────
//
// Each takes already-fetched signal facts and returns a PathResult, or null
// when the path simply does not apply for this (client, PE) pair.

/**
 * Strongest signal: a client capability explicitly lists this PE number.
 * Government-grade certainty → full score. null when no PE numbers matched.
 */
export function scoreCapabilityPeDirect(facts: {
  matchedPeNumbers: string[];
}): PathResult | null {
  const pes = facts.matchedPeNumbers ?? [];
  if (pes.length === 0) return null;
  return {
    path: 'capability_pe_direct',
    score: PE_DIRECT_SCORE,
    evidence: [`Capability lists PE ${pes.join(', ')}`],
  };
}

/**
 * Capability keywords / expanded tags match the PE's title/mission/project text.
 * The SERVICE applies the similarity FLOOR before calling; here we just clamp the
 * supplied similarity into [0,1]. null when no keywords matched.
 */
export function scoreCapabilityKeyword(facts: {
  matchedKeywords: string[];
  maxSimilarity: number;
}): PathResult | null {
  const keywords = facts.matchedKeywords ?? [];
  if (keywords.length === 0) return null;
  const score = clamp(facts.maxSimilarity, 0, 1);
  return {
    path: 'capability_keyword',
    score,
    evidence: [
      `Keyword match: ${keywords.join(', ')}`,
      `similarity ${round2(score)}`,
    ],
  };
}

/**
 * Client (by UEI / name) holds federal award(s) on this PE / program.
 * 0.8 base for >= 1 award, +0.1 (capped at 0.9) for >= 3. null when < 1.
 */
export function scorePriorAward(facts: {
  awardCount: number;
  totalAmountUsd: number;
}): PathResult | null {
  const count = facts.awardCount ?? 0;
  if (count < 1) return null;
  let score = PRIOR_AWARD_BASE_SCORE;
  if (count >= PRIOR_AWARD_VOLUME_THRESHOLD) {
    score += PRIOR_AWARD_VOLUME_BONUS;
  }
  score = Math.min(score, PRIOR_AWARD_MAX_SCORE);
  const plural = count === 1 ? 'award' : 'awards';
  return {
    path: 'prior_award',
    score,
    evidence: [
      `${count} prior ${plural} on this PE (~${formatUsd(facts.totalAmountUsd ?? 0)})`,
    ],
  };
}

/**
 * A client facility sits in a congressional district that has awards on this PE.
 * null when no districts matched.
 */
export function scoreFacilityDistrict(facts: {
  matchedDistricts: string[];
}): PathResult | null {
  const districts = facts.matchedDistricts ?? [];
  if (districts.length === 0) return null;
  return {
    path: 'facility_district',
    score: FACILITY_DISTRICT_SCORE,
    evidence: [`Facility in district(s): ${districts.join(', ')}`],
  };
}

/**
 * The client maps to a performer / awardee in the PE's ecosystem.
 * null when no performer names supplied.
 */
export function scoreEcosystem(facts: {
  performerNames: string[];
}): PathResult | null {
  const names = facts.performerNames ?? [];
  if (names.length === 0) return null;
  return {
    path: 'ecosystem',
    score: ECOSYSTEM_SCORE,
    evidence: [`Ecosystem performer(s): ${names.join(', ')}`],
  };
}

// ── Combination ──────────────────────────────────────────────────────────────

/**
 * Fold per-path results into one relevance score in [0,1].
 *
 *  - drop nulls and paths with score <= 0; if none → { score: 0, paths: [] }.
 *  - base = max contributing path score.
 *  - distinctStrong = count of contributing paths with score >= STRONG_PATH_FLOOR.
 *  - diversityBonus = min(MAX_DIVERSITY_BONUS, DIVERSITY_STEP * max(0, distinctStrong - 1)).
 *  - score = min(1, round2(base + diversityBonus)).
 *  - paths sorted by score desc (stable for equal scores).
 */
export function combineRelevance(paths: Array<PathResult | null>): {
  score: number;
  paths: PathResult[];
} {
  const contributing = (paths ?? []).filter(
    (p): p is PathResult => p != null && p.score > 0,
  );

  if (contributing.length === 0) {
    return { score: 0, paths: [] };
  }

  const base = Math.max(...contributing.map((p) => p.score));

  const distinctStrong = contributing.filter(
    (p) => p.score >= STRONG_PATH_FLOOR,
  ).length;

  const diversityBonus = Math.min(
    MAX_DIVERSITY_BONUS,
    DIVERSITY_STEP * Math.max(0, distinctStrong - 1),
  );

  const score = Math.min(1, round2(base + diversityBonus));

  // Sort by score desc; stable for ties (preserve input order via index key).
  const sorted = contributing
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.score - a.p.score || a.i - b.i)
    .map(({ p }) => p);

  return { score, paths: sorted };
}
