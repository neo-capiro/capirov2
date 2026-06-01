import { describe, expect, jest, test } from '@jest/globals';
import {
  ReconciliationService,
  shouldQueue,
  relativeDelta,
  sourceRank,
} from './reconciliation.service.js';

describe('shouldQueue (pure threshold logic, §4.1)', () => {
  test('same value → no discrepancy', () => {
    expect(shouldQueue('hascMark', 1000, 1000)).toEqual({ queued: false, deltaPct: 0 });
  });

  test('non-enacted, <=10% delta → not queued (logged only)', () => {
    // 1000 vs 1050 = 4.76% < 10%
    const r = shouldQueue('hascMark', 1000, 1050);
    expect(r.queued).toBe(false);
    expect(r.deltaPct).toBeCloseTo(0.0476, 3);
  });

  test('non-enacted, >10% delta → queued (over_threshold)', () => {
    // 1000 vs 1200 = 16.7% > 10%
    const r = shouldQueue('hascMark', 1000, 1200);
    expect(r.queued).toBe(true);
    expect(r.reason).toBe('over_threshold');
  });

  test('enacted: ANY non-zero conflict → queued regardless of small delta', () => {
    // 1000 vs 1001 = 0.1% — under 10% but enacted, so queue
    const r = shouldQueue('enacted', 1000, 1001);
    expect(r.queued).toBe(true);
    expect(r.reason).toBe('enacted_conflict');
  });

  test('enacted: equal values → not queued', () => {
    expect(shouldQueue('enacted', 5000, 5000).queued).toBe(false);
  });

  test('null on either side → not queued', () => {
    expect(shouldQueue('enacted', null, 100).queued).toBe(false);
    expect(shouldQueue('hascMark', 100, null).queued).toBe(false);
  });
});

describe('relativeDelta / sourceRank', () => {
  test('relativeDelta', () => {
    expect(relativeDelta(100, 100)).toBe(0);
    expect(relativeDelta(0, 0)).toBe(0);
    expect(relativeDelta(1000, 1200)).toBeCloseTo(0.1667, 3);
  });
  test('sourceRank: conference_report outranks usaspending; _fy suffix stripped', () => {
    expect(sourceRank('conference_report')).toBeLessThan(sourceRank('usaspending'));
    expect(sourceRank('hasc_report_fy27')).toBe(sourceRank('hasc_report'));
    expect(sourceRank('unknown_src')).toBeGreaterThan(sourceRank('bill_text'));
  });
});

interface QueuedEntry {
  peCode: string; fy: number; fieldName: string; conflictingSource: string;
  conflictingValue: string | null; currentValue: string | null; deltaPct: number | null; status: string;
}

function makeService(canonicalRow: Record<string, unknown> | null) {
  const sourceValues: Array<Record<string, unknown>> = [];
  const queue: QueuedEntry[] = [];

  const prisma = {
    programElementYear: {
      findUnique: jest.fn(async () => canonicalRow),
    },
    programElementYearSourceValue: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        sourceValues.push(args.data);
        return args.data;
      }),
    },
    reconciliationReviewQueue: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: { data: QueuedEntry }) => {
        queue.push(args.data);
        return args.data;
      }),
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test injection
  const svc = new ReconciliationService(prisma as any);
  return { svc, sourceValues, queue, prisma };
}

describe('ReconciliationService.reconcile', () => {
  test('two sources same value → source_value logged, NO queue entry', async () => {
    const { svc, sourceValues, queue } = makeService({ hascMark: 1000 });
    const results = await svc.reconcile({ peCode: '0603270A', fy: 2027, source: 'sasc_report', values: { hascMark: 1000 } });
    expect(sourceValues).toHaveLength(1); // value logged
    expect(queue).toHaveLength(0); // no discrepancy
    expect(results[0]?.queued).toBe(false);
  });

  test('lower-priority writes a DIFFERENT value → source_value populated, queue only if over threshold; small delta stays out', async () => {
    const { svc, sourceValues, queue } = makeService({ request: 1000 });
    await svc.reconcile({ peCode: '0603270A', fy: 2027, source: 'usaspending', values: { request: 1040 } }); // 3.8%
    expect(sourceValues).toHaveLength(1); // logged regardless
    expect(queue).toHaveLength(0); // under 10% → canonical unchanged, not queued
  });

  test('> 10% delta on a non-enacted field → review queue entry', async () => {
    const { svc, queue } = makeService({ hascMark: 1000 });
    await svc.reconcile({ peCode: '0603270A', fy: 2027, source: 'r_doc', values: { hascMark: 1300 } }); // 23%
    expect(queue).toHaveLength(1);
    expect(queue[0]?.fieldName).toBe('hascMark');
    expect(queue[0]?.currentValue).toBe('1000');
    expect(queue[0]?.conflictingValue).toBe('1300');
    expect(queue[0]?.status).toBe('open');
  });

  test('ANY conflict on enacted → review queue regardless of delta', async () => {
    const { svc, queue } = makeService({ enacted: 5000 });
    await svc.reconcile({ peCode: '0603270A', fy: 2027, source: 'usaspending', values: { enacted: 5001 } }); // 0.02%
    expect(queue).toHaveLength(1);
    expect(queue[0]?.fieldName).toBe('enacted');
  });

  test('no canonical row yet → logs values, queues nothing', async () => {
    const { svc, sourceValues, queue } = makeService(null);
    await svc.reconcile({ peCode: '0603270A', fy: 2027, source: 'hasc_report', values: { hascMark: 1000 } });
    expect(sourceValues).toHaveLength(1);
    expect(queue).toHaveLength(0);
  });
});
