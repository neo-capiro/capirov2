import {
  upsertBudgetPosition,
  buildPositionsFromFyColumns,
  type BudgetPositionClient,
  type BudgetPositionRow,
} from './budget-position-writer.js';
import { dollarsToMillions } from './jbook/jbook-extract.js';

/** In-memory ProgramElementBudgetPosition delegate keyed by the natural key. */
function makeClient() {
  const store = new Map<string, BudgetPositionRow>();
  let seq = 0;
  const keyOf = (w: Record<string, unknown>) => {
    const k = w.peCode_positionCycle_assertedFy_valueKind as Record<string, unknown>;
    return `${k.peCode}|${k.positionCycle}|${k.assertedFy}|${k.valueKind}`;
  };
  const client: BudgetPositionClient & {
    programElementBudgetPosition: {
      findUnique(args: { where: Record<string, unknown> }): Promise<BudgetPositionRow | null>;
    };
    __store: Map<string, BudgetPositionRow>;
  } = {
    __store: store,
    programElementBudgetPosition: {
      async findUnique({ where }) {
        return store.get(keyOf(where)) ?? null;
      },
      async upsert({ where, create, update }) {
        const key = keyOf(where);
        const existing = store.get(key);
        if (existing) {
          const merged = { ...existing, ...update } as BudgetPositionRow;
          store.set(key, merged);
          return merged;
        }
        const row = { id: `bp-${++seq}`, ...create } as BudgetPositionRow;
        store.set(key, row);
        return row;
      },
    },
  };
  return client;
}

describe('upsertBudgetPosition', () => {
  test('first write inserts (created=true), second identical write is a no-op update (created=false)', async () => {
    const client = makeClient();
    const input = {
      peCode: '0601102A',
      positionCycle: 'pb_fy2027',
      assertedFy: 2027,
      amount: 278.5,
      sourceUrl: 'http://r1.pdf',
      pageNumber: 12,
    };

    const first = await upsertBudgetPosition(client, input);
    expect(first.created).toBe(true);
    expect(client.__store.size).toBe(1);

    const second = await upsertBudgetPosition(client, input);
    expect(second.created).toBe(false);
    // Same natural key → still ONE row, not a duplicate.
    expect(client.__store.size).toBe(1);
    expect(second.position.id).toBe(first.position.id);
  });

  test('re-run with a changed amount updates the value in place (idempotent on key)', async () => {
    const client = makeClient();
    const base = { peCode: '0601102A', positionCycle: 'pb_fy2027', assertedFy: 2028, amount: 100 };

    await upsertBudgetPosition(client, base);
    const updated = await upsertBudgetPosition(client, { ...base, amount: 150 });

    expect(updated.created).toBe(false);
    expect(client.__store.size).toBe(1);
    expect(updated.position.amount).toBe(150);
  });

  test('different value kinds for the same (PE, cycle, FY) are distinct rows', async () => {
    const client = makeClient();
    const key = { peCode: '0601102A', positionCycle: 'pb_fy2027', assertedFy: 2027 };

    await upsertBudgetPosition(client, { ...key, amount: 278.5, valueKind: 'total' });
    await upsertBudgetPosition(client, { ...key, amount: 4, valueKind: 'quantity' });
    await upsertBudgetPosition(client, { ...key, amount: 69.6, valueKind: 'unit_cost' });

    expect(client.__store.size).toBe(3);
  });

  test('defaults valueKind to "total"', async () => {
    const client = makeClient();
    await upsertBudgetPosition(client, {
      peCode: '0601102A',
      positionCycle: 'pb_fy2027',
      assertedFy: 2027,
      amount: 1,
    });
    const [row] = [...client.__store.values()];
    expect(row?.valueKind).toBe('total');
  });
});

describe('buildPositionsFromFyColumns', () => {
  test('maps each FY column to a total position in $ millions, skipping null/absent', () => {
    const positions = buildPositionsFromFyColumns({
      peCode: '0601102A',
      positionCycle: 'pb_fy2027',
      fyColumns: { 2027: 278_500_000, 2028: 281_000_000, 2029: null, 2030: undefined },
      toMillions: dollarsToMillions,
      sourceUrl: 'http://r1.pdf',
      pageNumber: 144,
    });

    expect(positions).toEqual([
      expect.objectContaining({ assertedFy: 2027, amount: 278.5, valueKind: 'total', pageNumber: 144 }),
      expect.objectContaining({ assertedFy: 2028, amount: 281, valueKind: 'total' }),
    ]);
    // null + undefined columns are skipped (not written as 0).
    expect(positions).toHaveLength(2);
  });

  test('empty fyColumns → no positions (graceful no-op, the case today)', () => {
    expect(
      buildPositionsFromFyColumns({
        peCode: '0601102A',
        positionCycle: 'pb_fy2027',
        fyColumns: {},
        toMillions: dollarsToMillions,
      }),
    ).toEqual([]);
  });
});
