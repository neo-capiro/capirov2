import {
  checkBudgetReconciliation,
  componentForPeCode,
  computeGroupResult,
  summarizeExtractedTotals,
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
