/**
 * Step 4.1 — PURE accuracy-metric math for the §22 accuracy targets.
 *
 * No DB, no NestJS, no I/O. Every function takes a GOLDEN set (the human-verified
 * ground truth) and the ACTUAL values replayed from the current system, and returns a
 * single {@link MetricResult}: the measured fraction, the §22 target, and whether it
 * meets target. The CLI (`scripts/measure-accuracy.ts`) wires real DB reads into these;
 * the spec exercises them with mixed correct/incorrect fixtures.
 *
 * HONESTY NOTE: these functions compute the metric correctly, but they are only as
 * trustworthy as the golden set fed in. The committed golden sets under
 * `test/__golden__/` are SYNTHETIC placeholders — a real §22 number requires a
 * human-curated sample verified against the source PDFs (see that dir's README).
 *
 * Money convention: $ MILLIONS throughout (project-wide). `fundingValueAccuracy`
 * compares amounts already in millions; the default tolerance is in the same unit.
 */

/** One measured metric vs its §22 target. */
export interface MetricResult {
  /** Stable metric key (e.g. 'pe_identity_accuracy'). */
  metric: string;
  /**
   * Measured value in [0,1], or `null` when there was nothing to measure (empty
   * golden set / no live data to replay). A `null` value is NEVER a pass — it is
   * reported as "n/a" and `pass` is `false` so CI does not green-light an unmeasured
   * metric, but callers can distinguish "n/a" from a genuine miss via `value === null`.
   */
  value: number | null;
  /** The §22 target this metric must meet or exceed. */
  target: number;
  /** True iff `value !== null && value >= target`. */
  pass: boolean;
  /** Denominator used (sample size); 0 when the golden set was empty. */
  sampleSize: number;
}

/** Aggregate of every metric plus an overall gate. */
export interface AccuracySummary {
  metrics: MetricResult[];
  /** True iff every metric passed (and there was at least one metric). */
  allPass: boolean;
}

/**
 * §22 accuracy targets, exported as named constants so the CLI, the spec, and any
 * dashboard share one source of truth. Each is the minimum acceptable fraction.
 */
export const TARGETS = {
  /** PE identity (peCode + title) match — §22 ≥ 0.99. */
  PE_IDENTITY_ACCURACY: 0.99,
  /** Funding (BY amount) match within tolerance — §22 ≥ 0.99. */
  FUNDING_VALUE_ACCURACY: 0.99,
  /** Accepted PE→program match precision — §22 ≥ 0.95. */
  PROGRAM_MATCH_PRECISION: 0.95,
  /** Person→role precision — §22 ≥ 0.97. */
  PERSON_ROLE_PRECISION: 0.97,
  /** Delta classification accuracy — §22 ≥ 0.98. */
  DELTA_ACCURACY: 0.98,
} as const;

/**
 * Default tolerance (in $ MILLIONS) for `fundingValueAccuracy`. Two amounts count as
 * matching when |golden - actual| <= this. R-1 BY amounts are published to the nearest
 * $0.001M (thousands), so a small absolute tolerance absorbs rounding without masking a
 * real mismatch. Override per call when a golden set documents a different precision.
 */
export const FUNDING_TOLERANCE_M = 0.001;

// ---------------------------------------------------------------------------
// Golden / actual row shapes. Kept deliberately minimal — only the fields each
// metric compares. The CLI maps DB rows into these.
// ---------------------------------------------------------------------------

/** A row identifiable by `id`, the join key between golden and actual. */
export interface Identified {
  id: string;
}

export interface R1IdentityGolden extends Identified {
  peCode: string;
  title: string;
}
export interface R1IdentityActual extends Identified {
  peCode: string | null;
  title: string | null;
}

export interface FundingGolden extends Identified {
  /** Budget-year amount in $ MILLIONS. */
  byAmount: number;
}
export interface FundingActual extends Identified {
  byAmount: number | null;
}

/**
 * A binary-label golden row: `correct` is the human verdict for the corresponding
 * actual decision. Used for program-match and person-role precision. Precision is
 * measured over the rows the SYSTEM accepted; an `accepted` flag on the actual lets
 * the CLI pass the full sample and have the metric restrict to accepted rows.
 */
export interface LabelGolden extends Identified {
  /** Human verdict: was this (accepted) decision actually correct? */
  correct: boolean;
}
export interface DecisionActual extends Identified {
  /** Did the system ACCEPT this match/record? Precision is over accepted-only. */
  accepted: boolean;
}

export interface DeltaGolden extends Identified {
  /** The human-verified delta classification (e.g. 'cut' | 'increase' | 'new_start'). */
  deltaType: string;
}
export interface DeltaActual extends Identified {
  deltaType: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Index `actual` by id for O(1) lookup against the golden set. */
function byId<T extends Identified>(actual: readonly T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const row of actual) m.set(row.id, row);
  return m;
}

/**
 * Build a {@link MetricResult} from a hit count over a denominator. An empty
 * denominator yields `value: null` / `pass: false` (documented "n/a" behaviour — an
 * unmeasured metric is never a silent pass).
 */
function ratioResult(metric: string, hits: number, denom: number, target: number): MetricResult {
  if (denom === 0) {
    return { metric, value: null, target, pass: false, sampleSize: 0 };
  }
  const value = hits / denom;
  return { metric, value, target, pass: value >= target, sampleSize: denom };
}

/** Trim + case-fold a title for resilient comparison (whitespace/case are not signal). */
function normTitle(s: string | null | undefined): string {
  return (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// §22 metrics
// ---------------------------------------------------------------------------

/**
 * PE identity accuracy (§22 ≥ 0.99): fraction of sampled R-1 rows whose (peCode, title)
 * both match the golden row. A missing actual row (the PE wasn't found at all) counts
 * as a miss. peCode is compared case-insensitively (e.g. `0604123a` == `0604123A`);
 * title is compared after whitespace/case normalization.
 */
export function peIdentityAccuracy(
  golden: readonly R1IdentityGolden[],
  actual: readonly R1IdentityActual[],
): MetricResult {
  const index = byId(actual);
  let hits = 0;
  for (const g of golden) {
    const a = index.get(g.id);
    if (!a) continue;
    const peMatch = (a.peCode ?? '').trim().toLowerCase() === g.peCode.trim().toLowerCase();
    const titleMatch = normTitle(a.title) === normTitle(g.title);
    if (peMatch && titleMatch) hits++;
  }
  return ratioResult('pe_identity_accuracy', hits, golden.length, TARGETS.PE_IDENTITY_ACCURACY);
}

/**
 * Funding-value accuracy (§22 ≥ 0.99): fraction of sampled rows whose BY amount matches
 * the golden amount within `toleranceM` ($ MILLIONS). A null actual amount is a miss.
 */
export function fundingValueAccuracy(
  golden: readonly FundingGolden[],
  actual: readonly FundingActual[],
  toleranceM: number = FUNDING_TOLERANCE_M,
): MetricResult {
  const index = byId(actual);
  let hits = 0;
  for (const g of golden) {
    const a = index.get(g.id);
    if (!a || a.byAmount === null || a.byAmount === undefined) continue;
    if (Math.abs(a.byAmount - g.byAmount) <= toleranceM) hits++;
  }
  return ratioResult('funding_value_accuracy', hits, golden.length, TARGETS.FUNDING_VALUE_ACCURACY);
}

/**
 * Accepted PE→program match PRECISION (§22 ≥ 0.95): of the matches the SYSTEM accepted,
 * the fraction the golden set labels correct. The denominator is accepted-only (rows
 * where `actual.accepted === true`); golden rows with no corresponding accepted actual
 * are ignored (they were not accepted, so they cannot lower precision). A golden row
 * missing from `actual` for an accepted id counts as incorrect (we accepted something
 * the human never verified as correct).
 */
export function programMatchPrecision(
  golden: readonly LabelGolden[],
  actual: readonly DecisionActual[],
): MetricResult {
  return labelPrecision('program_match_precision', golden, actual, TARGETS.PROGRAM_MATCH_PRECISION);
}

/**
 * Person→role PRECISION (§22 ≥ 0.97): analogous to {@link programMatchPrecision} over
 * accepted person-role records.
 */
export function personRolePrecision(
  golden: readonly LabelGolden[],
  actual: readonly DecisionActual[],
): MetricResult {
  return labelPrecision('person_role_precision', golden, actual, TARGETS.PERSON_ROLE_PRECISION);
}

/** Shared precision-over-accepted body for the two label-precision metrics. */
function labelPrecision(
  metric: string,
  golden: readonly LabelGolden[],
  actual: readonly DecisionActual[],
  target: number,
): MetricResult {
  const goldenIndex = byId(golden);
  let accepted = 0;
  let correct = 0;
  for (const a of actual) {
    if (!a.accepted) continue;
    accepted++;
    const g = goldenIndex.get(a.id);
    // Accepted but unverified, or verified-incorrect → not a true positive.
    if (g && g.correct) correct++;
  }
  return ratioResult(metric, correct, accepted, target);
}

/**
 * Delta classification accuracy (§22 ≥ 0.98): fraction of sampled deltas whose `deltaType`
 * matches the golden classification (case-insensitive). A null actual classification is a
 * miss.
 */
export function deltaAccuracy(
  golden: readonly DeltaGolden[],
  actual: readonly DeltaActual[],
): MetricResult {
  const index = byId(actual);
  let hits = 0;
  for (const g of golden) {
    const a = index.get(g.id);
    if (!a || a.deltaType === null || a.deltaType === undefined) continue;
    if (a.deltaType.trim().toLowerCase() === g.deltaType.trim().toLowerCase()) hits++;
  }
  return ratioResult('delta_accuracy', hits, golden.length, TARGETS.DELTA_ACCURACY);
}

/**
 * Roll up a set of {@link MetricResult}s. `allPass` is true only when there is at least
 * one metric AND every metric passed (so an all-empty run is NOT a pass).
 */
export function summarize(results: readonly MetricResult[]): AccuracySummary {
  return {
    metrics: [...results],
    allPass: results.length > 0 && results.every((r) => r.pass),
  };
}
