import { describe, expect, test } from '@jest/globals';
import {
  ANALYSIS_EVAL_CASES,
  ANALYSIS_EVAL_CASE_COUNT,
  type AnalysisEvalCase,
} from './analysis-fixtures.js';

/**
 * Fixture-validity spec for the run_analysis eval (assistant-parity F4).
 * Every ground truth is RECOMPUTED here from the case's own rows, so a
 * fixture edit that breaks a hand-computed mustInclude fails loudly in CI
 * without burning tokens.
 */

function caseById(id: string): AnalysisEvalCase {
  const found = ANALYSIS_EVAL_CASES.find((c) => c.id === id);
  if (!found) throw new Error(`missing eval case: ${id}`);
  return found;
}

function rowsOf(c: AnalysisEvalCase, name: string): Array<Record<string, string | number>> {
  const dataset = c.datasets.find((d) => d.name === name);
  if (!dataset) throw new Error(`case ${c.id} is missing dataset ${name}`);
  return dataset.rows;
}

const num = (v: string | number | undefined): number => Number(v);

function sumBy(
  rows: Array<Record<string, string | number>>,
  keyField: string,
  valueField: string,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[keyField]);
    totals.set(key, (totals.get(key) ?? 0) + num(row[valueField]));
  }
  return totals;
}

function countBy(rows: Array<Record<string, string | number>>, keyField: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = String(row[keyField]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function maxEntry(totals: Map<string, number>): [string, number] {
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) throw new Error('empty aggregation');
  return sorted[0]!;
}

/** Assert the digits-only canonical fragment for `value` is in mustInclude. */
function expectNumberFragment(c: AnalysisEvalCase, value: number): void {
  expect(c.groundTruth.mustInclude).toContain(String(value));
}

describe('analysis eval fixtures — shape', () => {
  test('exactly 15 cases with unique ids', () => {
    expect(ANALYSIS_EVAL_CASE_COUNT).toBe(15);
    expect(ANALYSIS_EVAL_CASES.length).toBe(15);
    const ids = ANALYSIS_EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every case has a question, non-empty datasets, and non-empty mustInclude', () => {
    for (const c of ANALYSIS_EVAL_CASES) {
      expect(c.question.trim().length).toBeGreaterThan(10);
      expect(c.datasets.length).toBeGreaterThan(0);
      for (const d of c.datasets) {
        expect(d.name.trim()).toBeTruthy();
        expect(d.rows.length).toBeGreaterThan(0);
      }
      expect(c.groundTruth.mustInclude.length).toBeGreaterThan(0);
      for (const fragment of c.groundTruth.mustInclude) {
        expect(fragment.trim()).toBeTruthy();
        // The grader strips commas before matching — fragments must be the
        // comma-free canonical form or they could never match themselves.
        expect(fragment).not.toContain(',');
      }
    }
  });
});

describe('analysis eval fixtures — ground truths recomputed from rows', () => {
  test('lda-top-registrant: Capitol Partners LLC tops at 200000', () => {
    const c = caseById('lda-top-registrant');
    const totals = sumBy(rowsOf(c, 'lda_filings'), 'registrant', 'amount');
    const [topName, topTotal] = maxEntry(totals);
    expect(topName).toBe('Capitol Partners LLC');
    expect(topTotal).toBe(200000);
    expectNumberFragment(c, topTotal);
    expect(c.groundTruth.mustInclude.some((f) => topName.includes(f))).toBe(true);
  });

  test('lda-client-total-apex: 190000', () => {
    const c = caseById('lda-client-total-apex');
    const totals = sumBy(rowsOf(c, 'lda_filings'), 'client', 'amount');
    expect(totals.get('Apex Dynamics')).toBe(190000);
    expectNumberFragment(c, totals.get('Apex Dynamics')!);
  });

  test('lda-yoy-helios: 70000 (2024) -> 105000 (2025), +35000', () => {
    const c = caseById('lda-yoy-helios');
    const helios = rowsOf(c, 'lda_filings').filter((r) => r.client === 'Helios Aerospace');
    const byYear = sumBy(helios, 'year', 'amount');
    const y2024 = byYear.get('2024')!;
    const y2025 = byYear.get('2025')!;
    expect(y2024).toBe(70000);
    expect(y2025).toBe(105000);
    expect(y2025 - y2024).toBe(35000);
    expectNumberFragment(c, y2024);
    expectNumberFragment(c, y2025);
    expectNumberFragment(c, y2025 - y2024);
  });

  test('pe-yoy-enacted-0604858a: 150 -> 165 enacted, +10%', () => {
    const c = caseById('pe-yoy-enacted-0604858a');
    const rows = rowsOf(c, 'pe_budget').filter((r) => r.peCode === '0604858A');
    const fy25 = num(rows.find((r) => num(r.fiscalYear) === 2025)?.enactedMillions);
    const fy26 = num(rows.find((r) => num(r.fiscalYear) === 2026)?.enactedMillions);
    expect(fy25).toBe(150);
    expect(fy26).toBe(165);
    const pctChange = ((fy26 - fy25) / fy25) * 100;
    expect(pctChange).toBe(10);
    expectNumberFragment(c, fy25);
    expectNumberFragment(c, fy26);
    expectNumberFragment(c, pctChange);
  });

  test('pe-enacted-above-request: only FY2025 for 0207138F, by 16', () => {
    const c = caseById('pe-enacted-above-request');
    const rows = rowsOf(c, 'pe_budget').filter((r) => r.peCode === '0207138F');
    const above = rows.filter((r) => num(r.enactedMillions) > num(r.requestMillions));
    expect(above.length).toBe(1);
    const year = num(above[0]!.fiscalYear);
    const delta = num(above[0]!.enactedMillions) - num(above[0]!.requestMillions);
    expect(year).toBe(2025);
    expect(delta).toBe(16);
    expectNumberFragment(c, year);
    expectNumberFragment(c, delta);
  });

  test('pe-total-enacted-0207138f: 1018.5', () => {
    const c = caseById('pe-total-enacted-0207138f');
    const total = rowsOf(c, 'pe_budget')
      .filter((r) => r.peCode === '0207138F')
      .reduce((acc, r) => acc + num(r.enactedMillions), 0);
    expect(total).toBe(1018.5);
    expectNumberFragment(c, total);
  });

  test('pe-largest-request-growth: 0207138F grew by 110', () => {
    const c = caseById('pe-largest-request-growth');
    const rows = rowsOf(c, 'pe_budget');
    const growth = new Map<string, number>();
    for (const pe of new Set(rows.map((r) => String(r.peCode)))) {
      const fy24 = num(rows.find((r) => r.peCode === pe && num(r.fiscalYear) === 2024)?.requestMillions);
      const fy26 = num(rows.find((r) => r.peCode === pe && num(r.fiscalYear) === 2026)?.requestMillions);
      growth.set(pe, fy26 - fy24);
    }
    const [topPe, topGrowth] = maxEntry(growth);
    expect(topPe).toBe('0207138F');
    expect(topGrowth).toBe(110);
    expectNumberFragment(c, topGrowth);
    expect(c.groundTruth.mustInclude).toContain(topPe);
  });

  test('award-largest-single: Helios Aerospace at 4000000', () => {
    const c = caseById('award-largest-single');
    const rows = rowsOf(c, 'federal_awards');
    const top = [...rows].sort((a, b) => num(b.amountDollars) - num(a.amountDollars))[0]!;
    expect(String(top.recipient)).toBe('Helios Aerospace');
    expect(num(top.amountDollars)).toBe(4000000);
    expectNumberFragment(c, num(top.amountDollars));
    expect(c.groundTruth.mustInclude.some((f) => String(top.recipient).includes(f))).toBe(true);
  });

  test('award-avg-by-agency: Department of Defense highest at 2125000', () => {
    const c = caseById('award-avg-by-agency');
    const rows = rowsOf(c, 'federal_awards');
    const totals = sumBy(rows, 'agency', 'amountDollars');
    const counts = countBy(rows, 'agency');
    const averages = new Map<string, number>();
    for (const [agency, total] of totals) averages.set(agency, total / counts.get(agency)!);
    const [topAgency, topAvg] = maxEntry(averages);
    expect(topAgency).toBe('Department of Defense');
    expect(topAvg).toBe(2125000);
    expectNumberFragment(c, topAvg);
    expect(c.groundTruth.mustInclude.some((f) => topAgency.includes(f))).toBe(true);
  });

  test('award-total-ks: 5000000', () => {
    const c = caseById('award-total-ks');
    const total = rowsOf(c, 'federal_awards')
      .filter((r) => r.state === 'KS')
      .reduce((acc, r) => acc + num(r.amountDollars), 0);
    expect(total).toBe(5000000);
    expectNumberFragment(c, total);
  });

  test('award-count-by-district: MO-04 leads with 3 (unique max)', () => {
    const c = caseById('award-count-by-district');
    const counts = countBy(rowsOf(c, 'federal_awards'), 'district');
    const [topDistrict, topCount] = maxEntry(counts);
    expect(topDistrict).toBe('MO-04');
    expect(topCount).toBe(3);
    // The max must be unique or the question is ungradable.
    expect([...counts.values()].filter((v) => v === topCount).length).toBe(1);
    expectNumberFragment(c, topCount);
    expect(c.groundTruth.mustInclude).toContain(topDistrict);
  });

  test('award-total-nova: 2600000', () => {
    const c = caseById('award-total-nova');
    const total = rowsOf(c, 'federal_awards')
      .filter((r) => r.recipient === 'Nova Marine')
      .reduce((acc, r) => acc + num(r.amountDollars), 0);
    expect(total).toBe(2600000);
    expectNumberFragment(c, total);
  });

  test('facility-most-per-district: KS-04 with 3 (unique max)', () => {
    const c = caseById('facility-most-per-district');
    const counts = countBy(rowsOf(c, 'client_facilities'), 'district');
    const [topDistrict, topCount] = maxEntry(counts);
    expect(topDistrict).toBe('KS-04');
    expect(topCount).toBe(3);
    expect([...counts.values()].filter((v) => v === topCount).length).toBe(1);
    expectNumberFragment(c, topCount);
    expect(c.groundTruth.mustInclude).toContain(topDistrict);
  });

  test('facility-ks-employees: 2625', () => {
    const c = caseById('facility-ks-employees');
    const total = rowsOf(c, 'client_facilities')
      .filter((r) => r.state === 'KS')
      .reduce((acc, r) => acc + num(r.employees), 0);
    expect(total).toBe(2625);
    expectNumberFragment(c, total);
  });

  test('facility-mo-avg-employees: 425', () => {
    const c = caseById('facility-mo-avg-employees');
    const mo = rowsOf(c, 'client_facilities').filter((r) => r.state === 'MO');
    const avg = mo.reduce((acc, r) => acc + num(r.employees), 0) / mo.length;
    expect(avg).toBe(425);
    expectNumberFragment(c, avg);
  });
});
