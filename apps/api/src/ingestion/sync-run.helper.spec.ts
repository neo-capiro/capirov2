import {
  runWithSyncRun,
  lastSuccessfulWatermark,
  emptyCounts,
  type SyncRunCapablePrisma,
} from './sync-run.helper.js';

/** Minimal in-memory mock of the SyncRun prisma surface. */
function makePrisma(opts: { lastSuccess?: Date | null } = {}) {
  const calls: { create: any[]; update: any[]; findFirst: any[] } = {
    create: [],
    update: [],
    findFirst: [],
  };
  let seq = 0;
  const prisma: SyncRunCapablePrisma = {
    syncRun: {
      async findFirst(args: unknown) {
        calls.findFirst.push(args);
        return opts.lastSuccess ? { startedAt: opts.lastSuccess } : null;
      },
      async create(args: unknown) {
        calls.create.push(args);
        return { id: `run-${++seq}` };
      },
      async update(args: unknown) {
        calls.update.push(args);
        return {};
      },
    },
  };
  return { prisma, calls };
}

describe('runWithSyncRun (Phase 0 shared watermark)', () => {
  test('passes the last successful run startedAt as the incremental since', async () => {
    const wm = new Date('2026-05-30T08:00:00.000Z');
    const { prisma } = makePrisma({ lastSuccess: wm });
    let seenSince: Date | null = null;
    let seenSinceDate: string | null = null;

    await runWithSyncRun(prisma, 'sync-congress', async (ctx) => {
      seenSince = ctx.since;
      seenSinceDate = ctx.sinceDate;
      return { inserted: 5, updated: 2, skipped: 0, errors: 0 };
    });

    expect(seenSince).toEqual(wm);
    expect(seenSinceDate).toBe('2026-05-30');
  });

  test('first-ever run has null since (full pull)', async () => {
    const { prisma } = makePrisma({ lastSuccess: null });
    let seenSince: Date | null = new Date();
    await runWithSyncRun(prisma, 'sync-new', async (ctx) => {
      seenSince = ctx.since;
      return emptyCounts();
    });
    expect(seenSince).toBeNull();
  });

  test('overrideSince wins over the watermark', async () => {
    const wm = new Date('2026-05-30T00:00:00.000Z');
    const { prisma } = makePrisma({ lastSuccess: wm });
    let seenSinceDate: string | null = null;
    await runWithSyncRun(
      prisma,
      'sync-congress',
      async (ctx) => {
        seenSinceDate = ctx.sinceDate;
        return emptyCounts();
      },
      { overrideSince: '2020-01-01' },
    );
    expect(seenSinceDate).toBe('2020-01-01');
  });

  test('records success with row counts', async () => {
    const { prisma, calls } = makePrisma();
    await runWithSyncRun(prisma, 'sync-x', async () => ({
      inserted: 10,
      updated: 3,
      skipped: 1,
      errors: 0,
    }));
    expect(calls.create[0].data).toMatchObject({ source: 'sync-x', status: 'running' });
    expect(calls.update[0].data).toMatchObject({
      status: 'success',
      rowsInserted: 10,
      rowsUpdated: 3,
      errorCount: 0,
    });
  });

  test('partial errors downgrade to success_with_errors', async () => {
    const { prisma, calls } = makePrisma();
    await runWithSyncRun(prisma, 'sync-x', async () => ({
      inserted: 10,
      updated: 0,
      skipped: 0,
      errors: 2,
    }));
    expect(calls.update[0].data.status).toBe('success_with_errors');
    expect(calls.update[0].data.errorCount).toBe(2);
  });

  test('throwing fn records status=error and rethrows', async () => {
    const { prisma, calls } = makePrisma();
    await expect(
      runWithSyncRun(prisma, 'sync-x', async () => {
        throw new Error('upstream 503');
      }),
    ).rejects.toThrow('upstream 503');
    expect(calls.update[0].data.status).toBe('error');
    expect(calls.update[0].data.errorMessage).toContain('upstream 503');
  });
});

describe('lastSuccessfulWatermark', () => {
  test('returns null when no successful run', async () => {
    const { prisma } = makePrisma({ lastSuccess: null });
    expect(await lastSuccessfulWatermark(prisma, 'sync-x')).toBeNull();
  });
  test('returns the startedAt when present', async () => {
    const wm = new Date('2026-01-15T00:00:00.000Z');
    const { prisma } = makePrisma({ lastSuccess: wm });
    expect(await lastSuccessfulWatermark(prisma, 'sync-x')).toEqual(wm);
  });
});
