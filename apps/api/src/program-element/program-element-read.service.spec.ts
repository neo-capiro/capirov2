import { NotFoundException } from '@nestjs/common';
import type { TenantContext } from '@capiro/shared';
import { ProgramElementReadService } from './program-element-read.service.js';

const ctx: TenantContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  tenantSlug: 'capiro',
  userId: '00000000-0000-0000-0000-000000000002',
  clerkUserId: 'user_test',
  role: 'standard_user',
};

describe('ProgramElementReadService', () => {
  describe('listProgramElements markup monitor mode', () => {
    test('returns empty response when tenant context is missing', async () => {
      const prisma = makePrisma({
        queryRawQueue: [],
      });
      const service = new ProgramElementReadService(
        prisma as never,
        makeConferenceProbabilityService() as never,
      );

      const result = await service.listProgramElements({ mode: 'markup-monitor' });

      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 0 });
    });

    test('returns markup monitor rows for tenant-scoped watches', async () => {
      const prisma = makePrisma({
        queryRawQueue: [
          [
            {
              peCode: '0603270A',
              title: 'Electronic Warfare Advanced Payloads',
              service: 'Army',
              request: 100,
              hascMark: 120,
              sascMark: 90,
              hacDMark: null,
              sacDMark: 130,
              divergencePct: 40,
              totalCount: 1,
            },
          ],
        ],
      });
      const service = new ProgramElementReadService(
        prisma as never,
        makeConferenceProbabilityService() as never,
      );

      const result = await service.listProgramElements(
        { mode: 'markup-monitor', service: 'Army', divergenceThreshold: 10 },
        ctx,
      );

      expect(result.total).toBe(1);
      expect((result.data[0] as { peCode?: string } | undefined)?.peCode).toBe('0603270A');
      expect(prisma.__mock.queryRawCalls).toBe(1);
      expect(prisma.withTenant).toHaveBeenCalledWith(ctx.tenantId, expect.any(Function));
    });
  });

  describe('getProgramElement currentUserIsWatching', () => {
    test('cache hit on repeat call (live join path)', async () => {
      const prisma = makePrisma({
        queryRawQueue: [[], []],
        mvRows: [],
      });
      const service = new ProgramElementReadService(
        prisma as never,
        makeConferenceProbabilityService() as never,
      );

      await service.getProgramElement('0603270A', ctx);
      await service.getProgramElement('0603270A', ctx);

      expect(prisma.__mock.programElementFindUniqueCalls).toBe(1);
      expect(prisma.__mock.mvQueryRawCalls).toBe(1);
      expect(prisma.__mock.queryRawCalls).toBe(2);
    });

    test('cache miss after TTL (60s) reloads detail', async () => {
      const prisma = makePrisma({
        queryRawQueue: [[]],
        mvRows: [],
      });
      const service = new ProgramElementReadService(
        prisma as never,
        makeConferenceProbabilityService() as never,
      );

      const cache = (
        service as unknown as {
          detailCache: {
            clear: () => void;
            set: (key: string, value: Record<string, unknown>, options?: { ttl?: number }) => void;
          };
        }
      ).detailCache;

      cache.clear();
      cache.set('0603270A', { peCode: '0603270A', title: 'STALE' }, { ttl: 1 });
      await new Promise((resolve) => setTimeout(resolve, 5));

      const result = await service.getProgramElement('0603270A', ctx);
      const detail = result as { title?: string };

      expect(detail.title).toBe('Electronic Warfare Advanced Payloads');
      expect(prisma.__mock.programElementFindUniqueCalls).toBe(1);
    });

    test('enriches detail with billCount from the detail MV', async () => {
      // The base PE row is authoritative for header fields + the full year
      // history; the MV is queried only for the precomputed bill_count.
      const prisma = makePrisma({
        queryRawQueue: [[]],
        mvRows: [{ billCount: 9 }],
      });
      const service = new ProgramElementReadService(
        prisma as never,
        makeConferenceProbabilityService() as never,
      );

      const result = await service.getProgramElement('0603270A', ctx);
      const detail = result as { title?: string; billCount?: number; appropriationType?: string };

      expect(detail.title).toBe('Electronic Warfare Advanced Payloads');
      // appropriation type comes from the base row — the old MV path dropped it.
      expect(detail.appropriationType).toBe('RDT&E');
      expect(detail.billCount).toBe(9);
      expect(prisma.__mock.mvQueryRawCalls).toBe(1);
      expect(prisma.__mock.programElementFindUniqueCalls).toBe(1);
    });

    test('billCount refresh propagates after cache clear', async () => {
      const prisma = makePrisma({
        queryRawQueue: [[], []],
        mvRows: [{ billCount: 2 }],
      });
      const service = new ProgramElementReadService(
        prisma as never,
        makeConferenceProbabilityService() as never,
      );

      const first = await service.getProgramElement('0603270A', ctx);
      expect((first as { title?: string; billCount?: number }).title).toBe(
        'Electronic Warfare Advanced Payloads',
      );
      expect((first as { billCount?: number }).billCount).toBe(2);

      prisma.$queryRaw.mockResolvedValueOnce([{ billCount: 5 }]);

      const cache = (service as unknown as { detailCache: { clear: () => void } }).detailCache;
      cache.clear();

      const second = await service.getProgramElement('0603270A', ctx);
      const detail = second as { title?: string; billCount?: number };
      expect(detail.title).toBe('Electronic Warfare Advanced Payloads');
      expect(detail.billCount).toBe(5);
    });

    test('returns currentUserIsWatching=false when no watch rows', async () => {
      const prisma = makePrisma({
        queryRawQueue: [[]],
      });
      const service = new ProgramElementReadService(
        prisma as never,
        makeConferenceProbabilityService() as never,
      );

      const result = await service.getProgramElement('0603270A', ctx);

      expect(result.currentUserIsWatching).toBe(false);
    });

    test('returns currentUserIsWatching=true when one watch row exists', async () => {
      const prisma = makePrisma({
        queryRawQueue: [[{ id: 'watch-1' }]],
      });
      const service = new ProgramElementReadService(
        prisma as never,
        makeConferenceProbabilityService() as never,
      );

      const result = await service.getProgramElement('0603270A', ctx);

      expect(result.currentUserIsWatching).toBe(true);
    });

    test('throws NotFoundException for unknown PE', async () => {
      const prisma = makePrisma({
        missingPe: true,
        queryRawQueue: [[]],
      });
      const service = new ProgramElementReadService(
        prisma as never,
        makeConferenceProbabilityService() as never,
      );

      await expect(service.getProgramElement('BAD', ctx)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setWatching', () => {
    test('watch then unwatch toggles create/delete rows and returns state', async () => {
      const prisma = makePrisma({
        queryRawQueue: [[{ id: 'watch-created' }], [{ id: 'watch-created' }]],
      });
      const service = new ProgramElementReadService(
        prisma as never,
        makeConferenceProbabilityService() as never,
      );

      const watched = await service.setWatching('0603270A', true, ctx);
      const unwatched = await service.setWatching('0603270A', false, ctx);

      expect(watched).toEqual({ peCode: '0603270A', watching: true });
      expect(unwatched).toEqual({ peCode: '0603270A', watching: false });
      expect(prisma.__mock.queryRawCalls).toBe(2);
      expect(prisma.__mock.auditLogCalls).toHaveLength(2);
    });

    test('throws NotFoundException when PE does not exist', async () => {
      const prisma = makePrisma({
        missingPe: true,
        queryRawQueue: [[]],
      });
      const service = new ProgramElementReadService(
        prisma as never,
        makeConferenceProbabilityService() as never,
      );

      await expect(service.setWatching('BAD', true, ctx)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getTimeline conferenceProbability wiring', () => {
    test('attaches conferenceProbability prediction object to each year', async () => {
      const prisma = makePrisma({
        queryRawQueue: [[]],
      });
      const conferenceProbabilityService = makeConferenceProbabilityService({
        predicted: 251.2,
        ciLow: 247.0,
        ciHigh: 255.3,
        confidence: 0.66,
      });
      const service = new ProgramElementReadService(
        prisma as never,
        conferenceProbabilityService as never,
      );

      const result = await service.getTimeline('0603270A');

      expect(result.peCode).toBe('0603270A');
      expect(Array.isArray(result.years)).toBe(true);
      expect(result.years[0]?.conferenceProbability).toBe(251.2);
      expect(result.years[0]?.conferenceProbabilityCiLow).toBe(247.0);
      expect(result.years[0]?.conferenceProbabilityCiHigh).toBe(255.3);
      expect(result.years[0]?.conferenceProbabilityConfidence).toBe(0.66);
    });
  });
});

function makeConferenceProbabilityService(
  prediction: {
    predicted: number;
    ciLow: number;
    ciHigh: number;
    confidence: number;
  } | null = null,
) {
  return {
    predict: jest.fn(async () => prediction),
  };
}

function makePrisma(options: {
  queryRawQueue: Array<Array<Record<string, unknown>>>;
  missingPe?: boolean;
  mvRows?: Array<Record<string, unknown>>;
}) {
  const queue = [...options.queryRawQueue];
  const mock = {
    queryRawCalls: 0,
    mvQueryRawCalls: 0,
    programElementFindUniqueCalls: 0,
    auditLogCalls: [] as Array<Record<string, unknown>>,
  };

  return {
    __mock: mock,
    $queryRaw: jest.fn(async () => {
      mock.mvQueryRawCalls += 1;
      return options.mvRows ?? [];
    }),
    programElement: {
      findUnique: jest.fn(async () => {
        mock.programElementFindUniqueCalls += 1;
        if (options.missingPe) return null;
        return {
          peCode: '0603270A',
          title: 'Electronic Warfare Advanced Payloads',
          service: 'Army',
          budgetActivity: 'BA3',
          appropriationType: 'RDT&E',
          status: 'active',
          firstSeenFy: 2023,
          lastSyncedAt: new Date('2026-05-28T15:00:00.000Z'),
          years: [],
        };
      }),
    },
    programElementYear: {
      findMany: jest.fn(async () => [
        {
          id: 'year-1',
          peCode: '0603270A',
          fy: 2027,
          request: 278.5,
          hascMark: 290,
          sascMark: 284,
          hacDMark: 288,
          sacDMark: 281,
          conference: null,
          enacted: null,
          reprogrammed: null,
          executed: null,
          notes: 'Current cycle',
          rDocSection: 'FY2027 PB',
          raw: {},
          lastSyncedAt: new Date('2026-05-28T15:00:00.000Z'),
        },
      ]),
    },
    programElementMilestone: {
      findMany: jest.fn(async () => []),
    },
    // Step 1.2: getProgramElement now badges projectCount/sourceCount.
    programElementProject: {
      count: jest.fn(async () => 0),
    },
    programElementSource: {
      count: jest.fn(async () => 0),
    },
    withTenant: jest.fn(
      async (
        _tenantId: string,
        fn: (tx: { $queryRaw: jest.Mock; auditLog: { create: jest.Mock } }) => Promise<unknown>,
      ) => {
        return fn({
          $queryRaw: jest.fn(async () => {
            mock.queryRawCalls += 1;
            return queue.shift() ?? [];
          }),
          auditLog: {
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
              mock.auditLogCalls.push(data);
              return data;
            }),
          },
        });
      },
    ),
  };
}
