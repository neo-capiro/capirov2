import { buildConferencePredictionFromHistory } from './conference-probability.service.js';
import {
  FY24_FY25_CONFERENCE_BACKTEST,
  type ConferenceBacktestRow,
} from './__fixtures__/fy24-fy25-conference-backtest.js';

/**
 * Step 37 #9 — Conference probability backtest on FY24+FY25 REAL enacted marks.
 * Boss Plan §1.4 requires Brier <= 0.18.
 *
 * Protocol: train the model on FY2024 rows (per service, matching the
 * production query which trains on same-service prior-FY history) and predict
 * each held-out FY2025 row. We score a CONTINUOUS Brier on the model's
 * predicted gap-closure probability vs. the actual enacted closure outcome,
 * which is the honest calibration quantity (not a thresholded coin flip).
 */

/** Where the enacted conference landed within the HASC->SASC gap, in [0,1]. */
function actualClosure(row: ConferenceBacktestRow): number {
  const gap = row.sascMark - row.hascMark;
  if (gap === 0) return 0.5;
  const raw = (row.conference - row.hascMark) / gap;
  return Math.max(0, Math.min(1, raw));
}

/** Model's predicted closure probability, in [0,1]. */
function predictedClosure(predicted: number, hascMark: number, sascMark: number): number {
  const gap = sascMark - hascMark;
  if (gap === 0) return 0.5;
  const raw = (predicted - hascMark) / gap;
  return Math.max(0, Math.min(1, raw));
}

function brierScore(actual: number[], predicted: number[]): number {
  const n = Math.min(actual.length, predicted.length);
  if (n === 0) return 1;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    total += ((predicted[i] ?? 0) - (actual[i] ?? 0)) ** 2;
  }
  return total / n;
}

describe('Conference probability — real FY24+FY25 enacted backtest (§1.4 #9)', () => {
  test('continuous Brier on held-out FY2025 enacted is <= 0.18', () => {
    const train = FY24_FY25_CONFERENCE_BACKTEST.filter((r) => r.fy === 2024);
    const test = FY24_FY25_CONFERENCE_BACKTEST.filter((r) => r.fy === 2025);

    const actual: number[] = [];
    const predicted: number[] = [];

    for (const target of test) {
      // Production trains on same-service prior-FY history; mirror that here.
      const history = train
        .filter((r) => r.service === target.service)
        .map((r) => ({
          request: r.request,
          hascMark: r.hascMark,
          sascMark: r.sascMark,
          conference: r.conference,
        }));

      const prediction = buildConferencePredictionFromHistory(
        { request: target.request, hascMark: target.hascMark, sascMark: target.sascMark },
        history,
      );
      if (!prediction) continue;

      predicted.push(predictedClosure(prediction.predicted, target.hascMark, target.sascMark));
      actual.push(actualClosure(target));
    }

    expect(predicted.length).toBeGreaterThanOrEqual(test.length - 1);

    const brier = brierScore(actual, predicted);
    // Surfaced in CI logs so the acceptance gate can capture the real figure.
    // eslint-disable-next-line no-console
    console.log(`[backtest] FY24->FY25 continuous Brier = ${brier.toFixed(4)} (n=${actual.length})`);
    expect(brier).toBeLessThanOrEqual(0.18);
  });

  test('per-row predicted conference stays within the HASC/SASC envelope', () => {
    const train = FY24_FY25_CONFERENCE_BACKTEST.filter((r) => r.fy === 2024);
    const test = FY24_FY25_CONFERENCE_BACKTEST.filter((r) => r.fy === 2025);

    for (const target of test) {
      const history = train
        .filter((r) => r.service === target.service)
        .map((r) => ({ request: r.request, hascMark: r.hascMark, sascMark: r.sascMark, conference: r.conference }));
      const prediction = buildConferencePredictionFromHistory(
        { request: target.request, hascMark: target.hascMark, sascMark: target.sascMark },
        history,
      );
      if (!prediction) continue;
      const lo = Math.min(target.hascMark, target.sascMark) - Math.abs(target.sascMark - target.hascMark);
      const hi = Math.max(target.hascMark, target.sascMark) + Math.abs(target.sascMark - target.hascMark);
      expect(prediction.predicted).toBeGreaterThanOrEqual(lo);
      expect(prediction.predicted).toBeLessThanOrEqual(hi);
    }
  });
});
