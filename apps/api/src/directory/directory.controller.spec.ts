import { describe, expect, jest, test } from '@jest/globals';
import type { TenantContext } from '@capiro/shared';
import { DirectoryController } from './directory.controller.js';
import type { DirectoryService } from './directory.service.js';

/**
 * Controller-level test for the member FEC summary endpoint. The service method
 * itself is DB+S3-bound (covered by integration), so here we assert the route
 * delegates to the service with the tenant context + contactId.
 */
describe('DirectoryController — member FEC summary', () => {
  const ctx = { tenantId: 't1', userId: 'u1', role: 'standard_user' } as unknown as TenantContext;

  function make() {
    const service = {
      getMemberFecSummary: jest.fn(),
    } as unknown as DirectoryService & { getMemberFecSummary: jest.Mock };
    const controller = new DirectoryController(service);
    return { controller, service };
  }

  test('delegates to service.getMemberFecSummary with ctx + contactId', async () => {
    const { controller, service } = make();
    const payload = {
      contactId: 'm-1',
      memberName: 'Jane Member',
      matchQuality: 'name_approximate' as const,
      clients: [],
      summary: { totalAmount: 0, contributionCount: 0, clientCount: 0 },
      disclaimer: 'disclaimer text',
    };
    service.getMemberFecSummary.mockResolvedValueOnce(payload);

    const result = await controller.contactFecSummary(ctx, 'm-1');

    expect(service.getMemberFecSummary).toHaveBeenCalledWith(ctx, 'm-1');
    expect(result).toBe(payload);
  });
});
