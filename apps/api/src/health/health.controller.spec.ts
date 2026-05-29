import { describe, expect, jest, test } from '@jest/globals';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  test('GET /health/pe returns status payload from writer service', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ ok: 1 }]),
    };
    const peWriter = {
      getHealthSummary: jest.fn(async () => ({
        status: 'degraded' as const,
        last_sync_at_by_source: {
          r_doc_army: '2026-05-26T00:00:00.000Z',
        },
        rows_in_db: 123,
        quarantine_count: 22,
      })),
    };

    const controller = new HealthController(prisma as never, peWriter as never);

    const result = await controller.peHealth();

    expect(peWriter.getHealthSummary).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'degraded',
      last_sync_at_by_source: {
        r_doc_army: '2026-05-26T00:00:00.000Z',
      },
      rows_in_db: 123,
      quarantine_count: 22,
    });
  });
});
