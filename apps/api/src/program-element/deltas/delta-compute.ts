/**
 * Step 1.4 — PURE delta-derivation logic (no Prisma / Nest).
 *
 * Given a PE's ProgramElementYear rows, ProgramElementBudgetPosition rows, and
 * ProgramElementProcurementLine rows, derive the typed budget deltas. The Nest
 * `DeltaEngineService` fetches the rows and persists the result idempotently; this
 * module owns the math so it is unit-tested without a DB and reused by both the
 * engine and any read-time recompute.
 *
 * DELTA DEFINITIONS (authoritative — mirrored in delta-engine.service.ts doc comment):
 *   - mark_vs_request:     a committee mark (hasc/sasc/hac_d/sac_d) vs the request, same FY.
 *   - mark_vs_mark:        one chamber/committee mark vs another, same FY (HASC vs SASC etc.).
 *   - conference_vs_marks: conference vs the marks it reconciles, same FY.
 *   - enacted_vs_request:  enacted public-law value vs the request, same FY.
 *   - new_start:           PE/FY present now but absent from the prior PB AND prior FY years.
 *   - termination:         present in a prior PB but absent / zero across BY+outyears now.
 *   - zeroed:              a value that went to exactly 0 from a prior non-zero value.
 *   - transfer_candidate:  (engine-level, cross-PE) termination in one PE + new_start in
 *                          another in the same component w/ title trigram ≥0.6 — CANDIDATE
 *                          only, never asserted. Computed in the engine, not here.
 *   - outyear_shift:       |ΔFYDP total| ≥ max($20M, 15%) between two PB cycles (per FY).
 *   - quantity_change:     procurement line quantity change across cycles/FYs.
 *   - unit_cost_change:    procurement line unit-cost change across cycles/FYs.
 *   - pb_vs_prior_pb:      a PE's amount for an assertedFy in the current vs prior PB book.
 *   - project_level_change: (Step 1.5) project-level value change — dormant until R-2A
 *                          project values land.
 *
 * Money convention: all $ values are MILLIONS (project-wide; see program-element-writer).
 */

import { computePbComparison, type BudgetPositionLike } from '../budget-position.js';
import type { DeltaStage, DeltaTypeForScore } from './materiality-scorer.js';

/** A ProgramElementYear row, DB-agnostic (Decimal columns arrive as string|number). */
export interface YearLike {
  fy: number;
  request: number | string | null;
  hascMark: number | string | null;
  sascMark: number | string | null;
  hacDMark: number | string | null;
  sacDMark: number | string | null;
  conference: number | string | null;
  enacted: number | string | null;
}

/** A procurement line, DB-agnostic. */
export interface ProcurementLineLike {
  lineDescription: string;
  fy: number;
  quantity: number | string | null;
  unitCost: number | string | null;
  sourceUrl?: string | null;
}

/** One derived delta (pre-scoring). The engine layers materiality + persistence on top. */
export interface DerivedDelta {
  assertedFy: number;
  deltaType: DeltaTypeForScore;
  fromRef: string | null;
  toRef: string | null;
  amountFrom: number | null;
  amountTo: number | null;
  deltaAbs: number | null;
  /** Fractional change vs the from-side; null when from is missing/zero. */
  deltaPct: number | null;
  /** Stage of the TO-side, for stageSignificance scoring. */
  stage: DeltaStage;
  /** Provenance: which source rows/pages produced this delta. */
  evidence: Record<string, unknown>;
}

/** Thresholds (plan §6). */
export const OUTYEAR_SHIFT_ABS_M = 20;
export const OUTYEAR_SHIFT_PCT = 0.15;

function n(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function pct(from: number, to: number): number | null {
  if (from === 0) return null;
  return Math.round(((to - from) / Math.abs(from)) * 1e4) / 1e4;
}

/** Stage of each ProgramElementYear field (for stageSignificance). */
const FIELD_STAGE: Record<string, DeltaStage> = {
  request: 'pb',
  hascMark: 'marks',
  sascMark: 'marks',
  hacDMark: 'marks',
  sacDMark: 'marks',
  conference: 'conference',
  enacted: 'enacted',
};

const MARK_FIELDS = ['hascMark', 'sascMark', 'hacDMark', 'sacDMark'] as const;

/**
 * Stage-ladder deltas derived from a SINGLE ProgramElementYear row (one FY): the marks
 * vs the request, marks vs each other, conference vs the marks, and enacted vs request.
 * These have REAL data today (request + at least one mark for many PEs).
 */
export function deltasFromYear(year: YearLike): DerivedDelta[] {
  const out: DerivedDelta[] = [];
  const fy = year.fy;
  const request = n(year.request);
  const conference = n(year.conference);
  const enacted = n(year.enacted);

  const marks: Array<{ field: (typeof MARK_FIELDS)[number]; value: number }> = [];
  for (const field of MARK_FIELDS) {
    const v = n(year[field]);
    if (v !== null) marks.push({ field, value: v });
  }

  // mark_vs_request — each present mark against the request.
  if (request !== null) {
    for (const m of marks) {
      out.push(
        buildDelta('mark_vs_request', fy, 'request', m.field, request, m.value, 'marks', {
          fields: ['request', m.field],
        }),
      );
    }
    // enacted_vs_request
    if (enacted !== null) {
      out.push(
        buildDelta('enacted_vs_request', fy, 'request', 'enacted', request, enacted, 'enacted', {
          fields: ['request', 'enacted'],
        }),
      );
    }
  }

  // mark_vs_mark — distinct pairs of present marks (HASC vs SASC, etc.), stable order.
  for (let i = 0; i < marks.length; i += 1) {
    for (let j = i + 1; j < marks.length; j += 1) {
      const a = marks[i]!;
      const b = marks[j]!;
      if (a.value === b.value) continue; // no divergence → no delta
      out.push(
        buildDelta('mark_vs_mark', fy, a.field, b.field, a.value, b.value, 'marks', {
          fields: [a.field, b.field],
        }),
      );
    }
  }

  // conference_vs_marks — conference against each mark it reconciles.
  if (conference !== null) {
    for (const m of marks) {
      out.push(
        buildDelta('conference_vs_marks', fy, m.field, 'conference', m.value, conference, 'conference', {
          fields: [m.field, 'conference'],
        }),
      );
    }
    // zeroed: a mark/request was non-zero and conference brought it to 0.
    if (conference === 0 && request !== null && request > 0) {
      out.push(
        buildDelta('zeroed', fy, 'request', 'conference', request, 0, 'conference', {
          fields: ['request', 'conference'],
        }),
      );
    }
  }

  return out;
}

function buildDelta(
  deltaType: DeltaTypeForScore,
  assertedFy: number,
  fromRef: string | null,
  toRef: string | null,
  amountFrom: number | null,
  amountTo: number | null,
  stage: DeltaStage,
  evidence: Record<string, unknown>,
): DerivedDelta {
  const deltaAbs =
    amountFrom !== null && amountTo !== null ? round2(amountTo - amountFrom) : amountTo;
  const deltaPct = amountFrom !== null && amountTo !== null ? pct(amountFrom, amountTo) : null;
  return { assertedFy, deltaType, fromRef, toRef, amountFrom, amountTo, deltaAbs, deltaPct, stage, evidence };
}

/**
 * PB-vs-prior-PB + outyear_shift + new_start/termination derived from a PE's budget
 * positions across PB cycles. Reuses the unit-tested computePbComparison helper for the
 * per-FY current/prior amounts and flags, then classifies:
 *   - pb_vs_prior_pb: every FY present in both → the delta.
 *   - new_start:      FY newly present in the current PB (newInPb).
 *   - termination:    FY dropped from the current PB (droppedFromPb).
 *   - outyear_shift:  an OUTYEAR FY (assertedFy > the current PB's budget year) whose
 *                     |Δ| ≥ max($20M, 15%).
 * Dormant (returns []) until ≥2 PB books are loaded.
 */
export function deltasFromPositions(positions: BudgetPositionLike[]): DerivedDelta[] {
  const comparison = computePbComparison(positions);
  if (comparison.length === 0) return [];

  // The current PB's budget year = the lowest assertedFy among the current PB cycle's rows.
  const pbYears = positions
    .filter((p) => p.valueKind === 'total' && /^pb_fy\d{4}$/i.test(p.positionCycle))
    .map((p) => Number((/^pb_fy(\d{4})$/i.exec(p.positionCycle) ?? [])[1]))
    .filter((y) => Number.isFinite(y));
  const currentPbYear = pbYears.length ? Math.max(...pbYears) : null;

  const out: DerivedDelta[] = [];
  for (const row of comparison) {
    const fromRef = 'pb_prior';
    const toRef = 'pb_current';
    const ev = { source: 'budget_position', assertedFy: row.assertedFy };

    if (row.newInPb) {
      out.push({
        assertedFy: row.assertedFy,
        deltaType: 'new_start',
        fromRef: null,
        toRef,
        amountFrom: null,
        amountTo: row.pbCurrent,
        deltaAbs: row.pbCurrent,
        deltaPct: null,
        stage: 'pb',
        evidence: ev,
      });
      continue;
    }
    if (row.droppedFromPb) {
      out.push({
        assertedFy: row.assertedFy,
        deltaType: 'termination',
        fromRef,
        toRef: null,
        amountFrom: row.pbPrior,
        amountTo: null,
        deltaAbs: row.pbPrior !== null ? round2(-row.pbPrior) : null,
        deltaPct: null,
        stage: 'pb',
        evidence: ev,
      });
      continue;
    }

    if (row.pbCurrent === null || row.pbPrior === null) continue;

    // Always emit the pb_vs_prior_pb delta when both sides exist.
    out.push({
      assertedFy: row.assertedFy,
      deltaType: 'pb_vs_prior_pb',
      fromRef,
      toRef,
      amountFrom: row.pbPrior,
      amountTo: row.pbCurrent,
      deltaAbs: row.deltaAbs,
      deltaPct: row.deltaPct,
      stage: 'pb',
      evidence: ev,
    });

    // outyear_shift: an outyear FY whose movement clears max($20M, 15%).
    const isOutyear = currentPbYear !== null && row.assertedFy > currentPbYear;
    const abs = Math.abs(row.deltaAbs ?? 0);
    const meetsPct = row.deltaPct !== null && Math.abs(row.deltaPct) >= OUTYEAR_SHIFT_PCT;
    if (isOutyear && (abs >= OUTYEAR_SHIFT_ABS_M || meetsPct)) {
      out.push({
        assertedFy: row.assertedFy,
        deltaType: 'outyear_shift',
        fromRef,
        toRef,
        amountFrom: row.pbPrior,
        amountTo: row.pbCurrent,
        deltaAbs: row.deltaAbs,
        deltaPct: row.deltaPct,
        stage: 'pb',
        evidence: { ...ev, budgetYear: currentPbYear },
      });
    }
  }
  return out;
}

/**
 * quantity_change / unit_cost_change from procurement lines for ONE PE: compare a given
 * line (matched by lineDescription) across consecutive FYs. Dormant ([]) until P-1
 * procurement data lands (Step 1.1). Emits a delta per line per FY-transition where the
 * value actually moved.
 */
export function deltasFromProcurement(lines: ProcurementLineLike[]): DerivedDelta[] {
  if (lines.length === 0) return [];
  const byDesc = new Map<string, ProcurementLineLike[]>();
  for (const line of lines) {
    const key = line.lineDescription;
    if (!byDesc.has(key)) byDesc.set(key, []);
    byDesc.get(key)!.push(line);
  }

  const out: DerivedDelta[] = [];
  for (const [desc, group] of byDesc) {
    const sorted = [...group].sort((a, b) => a.fy - b.fy);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      const evBase = { source: 'procurement_line', lineDescription: desc, fromFy: prev.fy, toFy: cur.fy };

      const qFrom = n(prev.quantity);
      const qTo = n(cur.quantity);
      if (qFrom !== null && qTo !== null && qFrom !== qTo) {
        out.push({
          assertedFy: cur.fy,
          deltaType: 'quantity_change',
          fromRef: `fy${prev.fy}`,
          toRef: `fy${cur.fy}`,
          amountFrom: qFrom,
          amountTo: qTo,
          deltaAbs: round2(qTo - qFrom),
          deltaPct: pct(qFrom, qTo),
          stage: 'pb',
          evidence: { ...evBase, kind: 'quantity' },
        });
      }

      const uFrom = n(prev.unitCost);
      const uTo = n(cur.unitCost);
      if (uFrom !== null && uTo !== null && uFrom !== uTo) {
        out.push({
          assertedFy: cur.fy,
          deltaType: 'unit_cost_change',
          fromRef: `fy${prev.fy}`,
          toRef: `fy${cur.fy}`,
          amountFrom: uFrom,
          amountTo: uTo,
          deltaAbs: round2(uTo - uFrom),
          deltaPct: pct(uFrom, uTo),
          stage: 'pb',
          evidence: { ...evBase, kind: 'unit_cost' },
        });
      }
    }
  }
  return out;
}

/**
 * new_start / termination from the FY-year ladder (not PB positions): a PE that has its
 * FIRST-ever ProgramElementYear in `fy` (no earlier year, and no prior PB) is a new_start;
 * a PE whose latest year is non-zero then drops to absent is harder to detect from years
 * alone, so termination here is left to the PB-position path (deltasFromPositions). This
 * helper detects the new_start-from-years case so we still emit one when PB positions are
 * absent (the common case today).
 */
export function newStartFromYears(years: YearLike[], hasPriorPb: boolean): DerivedDelta[] {
  if (hasPriorPb || years.length === 0) return [];
  const sorted = [...years].sort((a, b) => a.fy - b.fy);
  const first = sorted[0]!;
  const firstValue =
    n(first.request) ?? n(first.hascMark) ?? n(first.conference) ?? n(first.enacted);
  if (firstValue === null) return [];
  // Only treat as a new_start when there is exactly one FY (a genuinely new line); a PE
  // with multiple FYs is an ongoing program, not a new start.
  if (sorted.length > 1) return [];
  return [
    {
      assertedFy: first.fy,
      deltaType: 'new_start',
      fromRef: null,
      toRef: 'request',
      amountFrom: null,
      amountTo: firstValue,
      deltaAbs: firstValue,
      deltaPct: null,
      stage: FIELD_STAGE.request ?? 'pb',
      evidence: { source: 'program_element_year', firstFy: first.fy },
    },
  ];
}
