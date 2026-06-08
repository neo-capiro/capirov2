import {
  checkBudgetReconciliation,
  checkPositionReconciliation,
  budgetCycleFromPositionCycle,
  componentForPeCode,
  computeGroupResult,
  summarizeExtractedTotals,
  summarizePositionTotals,
  type ControlTotals,
  type ExtractedGroup,
} from './budget-reconciliation.js';

describe('componentForPeCode', () => {
  it('derives the component from the 8th character', () => {
    expect(componentForPeCode('0601102A')).toBe('ARMY');
    expect(componentForPeCode('0603xxxN')).toBe('NAVY');
    expect(componentForPeCode('0604xxxF')).toBe('AF');
    expect(componentForPeCode('0604xxxD')).toBe('DW');
    expect(componentForPeCode('bad')).toBe('UNKNOWN');
  });
});

describe('summarizeExtractedTotals', () => {
  it('sums value fields into (fy, component, field) groups, ignoring nulls', () => {
    const groups = summarizeExtractedTotals([
      { peCode: '0601102A', fy: 2027, request: 100, hascMark: 120, sascMark: null },
      { peCode: '0601103A', fy: 2027, request: 50, hascMark: 60 },
      { peCode: '0601200N', fy: 2027, request: 30 },
    ]);
    const army = groups.filter((g) => g.component === 'ARMY');
    const armyRequest = army.find((g) => g.field === 'request')!;
    const armyHasc = army.find((g) => g.field === 'hascMark')!;
    expect(armyRequest).toMatchObject({ sumMillions: 150, count: 2 });
    expect(armyHasc).toMatchObject({ sumMillions: 180, count: 2 });
    expect(groups.find((g) => g.component === 'NAVY' && g.field === 'request')).toMatchObject({ sumMillions: 30, count: 1 });
    // sascMark was null for every row → no group produced.
    expect(groups.some((g) => g.field === 'sascMark')).toBe(false);
  });

  it('accepts Decimal-like values (toString) from Prisma', () => {
    const dec = (s: string) => ({ toString: () => s });
    const groups = summarizeExtractedTotals([{ peCode: '0601102A', fy: 2027, request: dec('215.32') }]);
    expect(groups[0]?.sumMillions).toBeCloseTo(215.32, 2);
  });
});

describe('computeGroupResult', () => {
  const g = (over: Partial<ExtractedGroup> = {}): ExtractedGroup => ({
    fiscalYear: 2027,
    component: 'ARMY',
    field: 'request',
    sumMillions: 1000,
    count: 10,
    ...over,
  });

  it('PASS within 0.5% tolerance', () => {
    expect(computeGroupResult(g({ sumMillions: 1000 }), 1000).status).toBe('PASS');
    expect(computeGroupResult(g({ sumMillions: 1004 }), 1000).status).toBe('PASS'); // 0.4%
  });

  it('FAIL beyond tolerance, with delta reported', () => {
    const r = computeGroupResult(g({ sumMillions: 1500 }), 1000);
    expect(r.status).toBe('FAIL');
    expect(r.deltaPct).toBeCloseTo(0.5, 5);
    expect(r.deltaMillions).toBe(500);
    expect(r.budgetCycle).toBe('pb');
  });

  it('SKIP when there is no control total for the group', () => {
    const r = computeGroupResult(g(), null);
    expect(r.status).toBe('SKIP');
    expect(r.reason).toMatch(/no control/);
  });
});

describe('checkBudgetReconciliation', () => {
  const control: ControlTotals = {
    groups: [
      { fiscalYear: 2027, budgetCycle: 'pb', component: 'ARMY', field: 'request', totalMillions: 150 },
      { fiscalYear: 2027, budgetCycle: 'hasc', component: 'ARMY', field: 'hascMark', totalMillions: 180 },
    ],
  };
  const fakePrisma = (rows: Array<Record<string, unknown>>) => ({
    programElementYear: { findMany: async () => rows },
  });

  it('all groups PASS when extracted matches control', async () => {
    const res = await checkBudgetReconciliation(
      fakePrisma([
        { peCode: '0601102A', fy: 2027, request: 100, hascMark: 120 },
        { peCode: '0601103A', fy: 2027, request: 50, hascMark: 60 },
      ]),
      control,
    );
    expect(res.ok).toBe(true);
    expect(res.failed).toBe(0);
    expect(res.passed).toBe(2);
  });

  it('flips to FAIL (ok=false) when a year row is corrupted', async () => {
    const res = await checkBudgetReconciliation(
      fakePrisma([
        { peCode: '0601102A', fy: 2027, request: 100, hascMark: 120 },
        { peCode: '0601103A', fy: 2027, request: 999, hascMark: 60 }, // corrupted request
      ]),
      control,
    );
    expect(res.ok).toBe(false);
    expect(res.failed).toBe(1);
    const failed = res.results.find((r) => r.status === 'FAIL')!;
    expect(failed.field).toBe('request');
  });

  it('SKIPs DB groups that have no control total (does not FAIL)', async () => {
    const res = await checkBudgetReconciliation(
      fakePrisma([{ peCode: '0601200N', fy: 2027, request: 30 }]), // NAVY — no control entry
      control,
    );
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(1);
    expect(res.checked).toBe(0);
  });
});

describe('budgetCycleFromPositionCycle', () => {
  it('strips the _fy<YYYY> suffix to the cycle prefix', () => {
    expect(budgetCycleFromPositionCycle('pb_fy2027')).toBe('pb');
    expect(budgetCycleFromPositionCycle('hasc_fy2027')).toBe('hasc');
    expect(budgetCycleFromPositionCycle('hac_d_fy2026')).toBe('hac_d');
    expect(budgetCycleFromPositionCycle('enacted_fy2026')).toBe('enacted');
    expect(budgetCycleFromPositionCycle('weird')).toBe('weird');
  });
});

describe('summarizePositionTotals', () => {
  it('sums value_kind=total positions into (assertedFy, cycle, component) groups', () => {
    const groups = summarizePositionTotals([
      { peCode: '0601102A', positionCycle: 'pb_fy2027', assertedFy: 2027, amount: 100, valueKind: 'total' },
      { peCode: '0601103A', positionCycle: 'pb_fy2027', assertedFy: 2027, amount: 50, valueKind: 'total' },
      { peCode: '0601102A', positionCycle: 'pb_fy2027', assertedFy: 2027, amount: 4, valueKind: 'quantity' }, // ignored
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ fiscalYear: 2027, budgetCycle: 'pb', component: 'ARMY', sumMillions: 150, count: 2 });
  });
});

describe('checkPositionReconciliation', () => {
  const control: ControlTotals = {
    groups: [{ fiscalYear: 2027, budgetCycle: 'pb', component: 'ARMY', field: 'request', totalMillions: 150 }],
  };

  it('is a graceful no-op (ok, empty) when the position delegate is absent', async () => {
    const res = await checkPositionReconciliation({ programElementYear: { findMany: async () => [] } } as never, control);
    expect(res).toMatchObject({ ok: true, checked: 0, results: [] });
  });

  it('is a graceful no-op when no positions are loaded (the case today)', async () => {
    const res = await checkPositionReconciliation(
      {
        programElementYear: { findMany: async () => [] },
        programElementBudgetPosition: { findMany: async () => [] },
      } as never,
      control,
    );
    expect(res.results).toHaveLength(0);
    expect(res.ok).toBe(true);
  });

  it('PASS when loaded positions match the control total', async () => {
    const res = await checkPositionReconciliation(
      {
        programElementYear: { findMany: async () => [] },
        programElementBudgetPosition: {
          findMany: async () => [
            { peCode: '0601102A', positionCycle: 'pb_fy2027', assertedFy: 2027, amount: 100, valueKind: 'total' },
            { peCode: '0601103A', positionCycle: 'pb_fy2027', assertedFy: 2027, amount: 50, valueKind: 'total' },
          ],
        },
      } as never,
      control,
    );
    expect(res.ok).toBe(true);
    expect(res.passed).toBe(1);
  });

  it('FAILs when a loaded position cycle diverges from control', async () => {
    const res = await checkPositionReconciliation(
      {
        programElementYear: { findMany: async () => [] },
        programElementBudgetPosition: {
          findMany: async () => [
            { peCode: '0601102A', positionCycle: 'pb_fy2027', assertedFy: 2027, amount: 999, valueKind: 'total' },
          ],
        },
      } as never,
      control,
    );
    expect(res.ok).toBe(false);
    expect(res.failed).toBe(1);
  });

  it('no-ops (does not throw) when the table is absent (findMany rejects)', async () => {
    const res = await checkPositionReconciliation(
      {
        programElementYear: { findMany: async () => [] },
        programElementBudgetPosition: {
          findMany: async () => {
            throw new Error('relation "program_element_budget_position" does not exist');
          },
        },
      } as never,
      control,
    );
    expect(res).toMatchObject({ ok: true, results: [] });
  });
});
