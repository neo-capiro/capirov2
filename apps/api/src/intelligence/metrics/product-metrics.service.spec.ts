import type { TenantContext } from '@capiro/shared';
import { ProductMetricsService, summarizeCards, isoWeekKey } from './product-metrics.service.js';

/**
 * Step 4.1 — ProductMetricsService (§24). The read path is exercised through a mock
 * prisma double whose `withTenant` runs the callback against fake stores; the pure
 * `summarizeCards` aggregation is also tested directly. Asserts: ISO-week bucketing, the
 * accepted/dismissed/north-star definitions, and the delta→card median.
 */

const ctx: TenantContext = {
  tenantId: '00000000-0000-0000-0000-0000000000a1',
  tenantSlug: 'capiro',
  userId: '00000000-0000-0000-0000-0000000000b2',
  clerkUserId: 'user_test',
  role: 'standard_user',
};

interface CardSeed {
  status: string;
  clientId?: string;
  deltaId?: string | null;
  createdAt: Date;
}

function makePrisma(cards: CardSeed[], deltas: Array<{ id: string; computedAt: Date }> = []) {
  const cardRows = cards.map((c) => ({
    status: c.status,
    clientId: c.clientId ?? '11111111-1111-1111-1111-111111111111',
    deltaId: c.deltaId ?? null,
    createdAt: c.createdAt,
  }));
  const tx = {
    actionRecommendation: {
      findMany: jest.fn(async () => cardRows),
    },
    programElementDelta: {
      findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
        deltas.filter((d) => args.where.id.in.includes(d.id)),
      ),
    },
  };
  const prisma = {
    __tx: tx,
    withTenant: jest.fn(async (_t: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return prisma;
}

describe('isoWeekKey', () => {
  test('formats YYYY-Www, Monday-based', () => {
    // 2026-06-08 is a Monday in ISO week 24 of 2026.
    expect(isoWeekKey(new Date('2026-06-08T12:00:00Z'))).toBe('2026-W24');
    // 2026-06-07 is the Sunday that closes ISO week 23.
    expect(isoWeekKey(new Date('2026-06-07T23:59:00Z'))).toBe('2026-W23');
  });

  test('week 1 / year boundary (2026-01-01 falls in ISO week 1)', () => {
    expect(isoWeekKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
  });
});

describe('summarizeCards', () => {
  test('buckets by ISO week and applies the accepted/dismissed/north-star definitions', () => {
    const wkA = new Date('2026-06-02T00:00:00Z'); // ISO 2026-W23
    const wkB = new Date('2026-06-09T00:00:00Z'); // ISO 2026-W24
    const summary = summarizeCards(
      [
        // Week 23: 1 new (generated only), 1 accepted+source-backed (north-star),
        //          1 accepted no-delta (accepted but NOT north-star), 1 dismissed.
        { status: 'new', deltaId: null, clientId: 'c1', createdAt: wkA },
        { status: 'assigned', deltaId: 'd1', clientId: 'c1', createdAt: wkA },
        { status: 'drafting', deltaId: null, clientId: 'c1', createdAt: wkA },
        { status: 'dismissed', deltaId: 'd2', clientId: 'c1', createdAt: wkA },
        // Week 24: 1 triaged (intake, not accepted), 1 sent_to_client+delta (north-star).
        { status: 'triaged', deltaId: null, clientId: 'c1', createdAt: wkB },
        { status: 'sent_to_client', deltaId: 'd3', clientId: 'c1', createdAt: wkB },
      ],
      new Map(),
    );

    expect(summary.weekly.map((w) => w.isoWeek)).toEqual(['2026-W23', '2026-W24']);

    const w23 = summary.weekly[0]!;
    expect(w23.generated).toBe(4);
    expect(w23.accepted).toBe(2); // assigned + drafting
    expect(w23.dismissed).toBe(1);
    expect(w23.northStarAccepted).toBe(1); // only the accepted card WITH a deltaId

    const w24 = summary.weekly[1]!;
    expect(w24.generated).toBe(2);
    expect(w24.accepted).toBe(1); // sent_to_client; triaged is intake
    expect(w24.northStarAccepted).toBe(1);

    expect(summary.totals).toEqual({
      generated: 6,
      accepted: 3,
      dismissed: 1,
      northStarAccepted: 2,
    });
  });

  test("intake statuses ('new','triaged') and 'archived' are NOT accepted", () => {
    const now = new Date('2026-06-02T00:00:00Z');
    const summary = summarizeCards(
      [
        { status: 'new', deltaId: 'd1', clientId: 'c', createdAt: now },
        { status: 'triaged', deltaId: 'd2', clientId: 'c', createdAt: now },
        { status: 'archived', deltaId: 'd3', clientId: 'c', createdAt: now },
      ],
      new Map(),
    );
    expect(summary.totals.accepted).toBe(0);
    expect(summary.totals.northStarAccepted).toBe(0);
    expect(summary.totals.generated).toBe(3);
  });

  test('median delta→card latency in minutes; negative (clock skew) excluded', () => {
    const created = new Date('2026-06-02T01:00:00Z');
    const computedAtById = new Map<string, Date>([
      ['d1', new Date('2026-06-02T00:00:00Z')], // 60 min
      ['d2', new Date('2026-06-02T00:30:00Z')], // 30 min
      ['d3', new Date('2026-06-02T02:00:00Z')], // -60 min → excluded
    ]);
    const summary = summarizeCards(
      [
        { status: 'assigned', deltaId: 'd1', clientId: 'c', createdAt: created },
        { status: 'assigned', deltaId: 'd2', clientId: 'c', createdAt: created },
        { status: 'assigned', deltaId: 'd3', clientId: 'c', createdAt: created },
        { status: 'assigned', deltaId: null, clientId: 'c', createdAt: created }, // no delta
      ],
      computedAtById,
    );
    // latencies = [60, 30] → median 45; d3 negative excluded, no-delta ignored.
    expect(summary.deltaToCardSampleSize).toBe(2);
    expect(summary.medianDeltaToCardMinutes).toBe(45);
  });

  test('no resolvable delta pairs → median null', () => {
    const summary = summarizeCards(
      [{ status: 'assigned', deltaId: null, clientId: 'c', createdAt: new Date() }],
      new Map(),
    );
    expect(summary.medianDeltaToCardMinutes).toBeNull();
    expect(summary.deltaToCardSampleSize).toBe(0);
  });

  test('exposes the definitions on the summary', () => {
    const summary = summarizeCards([], new Map());
    expect(summary.definitions.accepted).toMatch(/advanced past intake/);
    expect(summary.definitions.northStar).toMatch(/source-backed/);
    expect(summary.definitions.dismissed).toMatch(/dismissed/);
  });
});

describe('ProductMetricsService.getProductMetrics', () => {
  test('reads tenant cards + global deltas and returns the weekly summary', async () => {
    const created = new Date('2026-06-02T01:00:00Z');
    const prisma = makePrisma(
      [
        { status: 'sent_to_client', deltaId: 'd1', createdAt: created },
        { status: 'dismissed', deltaId: null, createdAt: created },
      ],
      [{ id: 'd1', computedAt: new Date('2026-06-02T00:00:00Z') }],
    );
    const service = new ProductMetricsService(prisma as never);

    const summary = await service.getProductMetrics(ctx);

    expect(prisma.withTenant).toHaveBeenCalledWith(ctx.tenantId, expect.any(Function));
    // Only the deltaId actually present is queried.
    expect(prisma.__tx.programElementDelta.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['d1'] } },
      select: { id: true, computedAt: true },
    });
    expect(summary.totals.generated).toBe(2);
    expect(summary.totals.accepted).toBe(1);
    expect(summary.totals.northStarAccepted).toBe(1);
    expect(summary.totals.dismissed).toBe(1);
    expect(summary.medianDeltaToCardMinutes).toBe(60);
  });

  test('no cards with deltaId → skips the delta query entirely', async () => {
    const prisma = makePrisma([{ status: 'new', deltaId: null, createdAt: new Date() }]);
    const service = new ProductMetricsService(prisma as never);

    await service.getProductMetrics(ctx);

    expect(prisma.__tx.programElementDelta.findMany).not.toHaveBeenCalled();
  });
});
