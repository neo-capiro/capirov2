import {
  computePbComparison,
  pbCycleSubmissionYear,
  type BudgetPositionLike,
} from './budget-position.js';

const total = (positionCycle: string, assertedFy: number, amount: number | string | null): BudgetPositionLike => ({
  positionCycle,
  assertedFy,
  amount,
  valueKind: 'total',
});

describe('pbCycleSubmissionYear', () => {
  test.each([
    ['pb_fy2027', 2027],
    ['pb_fy2026', 2026],
    ['PB_FY2025', 2025],
    ['hasc_fy2027', null],
    ['enacted_fy2026', null],
    ['pb_fyXXXX', null],
    ['', null],
  ])('%s → %s', (cycle, expected) => {
    expect(pbCycleSubmissionYear(cycle)).toBe(expected);
  });
});

describe('computePbComparison', () => {
  test('returns [] when fewer than two PB cycles are present', () => {
    expect(computePbComparison([])).toEqual([]);
    expect(computePbComparison([total('pb_fy2027', 2027, 100)])).toEqual([]);
    // A non-PB second cycle does not count as a second PB submission.
    expect(
      computePbComparison([
        total('pb_fy2027', 2027, 100),
        { positionCycle: 'hasc_fy2027', assertedFy: 2027, amount: 120, valueKind: 'total' },
      ]),
    ).toEqual([]);
  });

  test('current = highest submission year, prior = second-highest', () => {
    const rows = computePbComparison([
      total('pb_fy2026', 2027, 200), // prior PB's projection for FY27
      total('pb_fy2027', 2027, 250), // current PB's request for FY27
    ]);
    expect(rows).toEqual([
      {
        assertedFy: 2027,
        pbCurrent: 250,
        pbPrior: 200,
        deltaAbs: 50,
        deltaPct: 0.25,
        newInPb: false,
        droppedFromPb: false,
      },
    ]);
  });

  test('negative delta + fractional pct rounding (4 dp)', () => {
    const [row] = computePbComparison([
      total('pb_fy2026', 2028, 300),
      total('pb_fy2027', 2028, 280),
    ]);
    expect(row).toMatchObject({ assertedFy: 2028, pbCurrent: 280, pbPrior: 300, deltaAbs: -20 });
    // -20 / 300 = -0.066666..., rounded to 4 dp.
    expect(row?.deltaPct).toBe(-0.0667);
  });

  test('new_in_pb: FY present in current PB, absent from prior', () => {
    const rows = computePbComparison([
      total('pb_fy2026', 2027, 100), // shared FY so there are ≥2 cycles
      total('pb_fy2027', 2027, 110),
      total('pb_fy2027', 2031, 90), // BY5 outyear new this cycle
    ]);
    const fy2031 = rows.find((r) => r.assertedFy === 2031);
    expect(fy2031).toMatchObject({
      pbCurrent: 90,
      pbPrior: null,
      deltaAbs: null,
      deltaPct: null,
      newInPb: true,
      droppedFromPb: false,
    });
  });

  test('dropped_from_pb: FY present in prior PB, absent from current', () => {
    const rows = computePbComparison([
      total('pb_fy2026', 2027, 100),
      total('pb_fy2026', 2030, 80), // prior PB projected FY30
      total('pb_fy2027', 2027, 110), // current PB drops FY30
    ]);
    const fy2030 = rows.find((r) => r.assertedFy === 2030);
    expect(fy2030).toMatchObject({
      pbCurrent: null,
      pbPrior: 80,
      deltaAbs: null,
      deltaPct: null,
      newInPb: false,
      droppedFromPb: true,
    });
  });

  test('null amount in prior is treated as missing → new_in_pb, no delta', () => {
    const rows = computePbComparison([
      total('pb_fy2026', 2029, null), // prior FY row exists but value is null
      total('pb_fy2026', 2027, 100),
      total('pb_fy2027', 2027, 110),
      total('pb_fy2027', 2029, 70),
    ]);
    const fy2029 = rows.find((r) => r.assertedFy === 2029);
    expect(fy2029).toMatchObject({
      pbCurrent: 70,
      pbPrior: null,
      deltaAbs: null,
      deltaPct: null,
      newInPb: true,
      droppedFromPb: false,
    });
  });

  test('zero prior is a real value: deltaAbs computed, deltaPct null (no ratio)', () => {
    const [row] = computePbComparison([
      total('pb_fy2026', 2027, 0),
      total('pb_fy2027', 2027, 40),
    ]);
    expect(row).toMatchObject({
      assertedFy: 2027,
      pbCurrent: 40,
      pbPrior: 0,
      deltaAbs: 40,
      deltaPct: null, // division by zero avoided
      newInPb: false, // prior is 0 (a real value), not missing
      droppedFromPb: false,
    });
  });

  test('zero current with positive prior: deltaAbs negative, not flagged dropped', () => {
    const [row] = computePbComparison([
      total('pb_fy2026', 2027, 50),
      total('pb_fy2027', 2027, 0),
    ]);
    expect(row).toMatchObject({
      pbCurrent: 0,
      pbPrior: 50,
      deltaAbs: -50,
      deltaPct: -1,
      droppedFromPb: false, // current is 0 (a real value), not missing
    });
  });

  test('coerces Decimal-as-string amounts', () => {
    const [row] = computePbComparison([
      total('pb_fy2026', 2027, '200.00'),
      total('pb_fy2027', 2027, '250.50'),
    ]);
    expect(row).toMatchObject({ pbCurrent: 250.5, pbPrior: 200, deltaAbs: 50.5 });
  });

  test('three PB books → uses the two most recent (FY27 vs FY26), ignores FY25', () => {
    const rows = computePbComparison([
      total('pb_fy2025', 2027, 999), // ignored: not one of the two latest
      total('pb_fy2026', 2027, 200),
      total('pb_fy2027', 2027, 250),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pbCurrent: 250, pbPrior: 200 });
  });

  test('rows ordered by assertedFy ascending', () => {
    const rows = computePbComparison([
      total('pb_fy2027', 2031, 10),
      total('pb_fy2027', 2027, 100),
      total('pb_fy2026', 2027, 90),
      total('pb_fy2026', 2031, 9),
    ]);
    expect(rows.map((r) => r.assertedFy)).toEqual([2027, 2031]);
  });

  test('ignores non-total value kinds', () => {
    const rows = computePbComparison([
      { positionCycle: 'pb_fy2026', assertedFy: 2027, amount: 5, valueKind: 'quantity' },
      { positionCycle: 'pb_fy2027', assertedFy: 2027, amount: 6, valueKind: 'quantity' },
    ]);
    // No 'total' rows → no comparison.
    expect(rows).toEqual([]);
  });
});
