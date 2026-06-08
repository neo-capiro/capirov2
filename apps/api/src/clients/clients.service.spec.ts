import { ClientsService } from './clients.service.js';

describe('ClientsService.list — archived filtering', () => {
  const ctx = { tenantId: 'tenant-1', userId: 'user-1' } as never;

  const makeService = () => {
    const tenantTx = {
      client: { findMany: jest.fn(async () => [] as unknown[]) },
    };
    const prisma = {
      withTenant: jest.fn(async (_tenantId: string, run: (tx: unknown) => Promise<unknown>) =>
        run(tenantTx),
      ),
    };
    // No ASSETS_BUCKET configured → logo signing is skipped (clients list is empty).
    const config = { get: jest.fn(() => undefined) };
    // resolve-on-create dependencies; unused by the list() paths under test.
    const entityResolution = { resolveClient: jest.fn(async () => ({ created: 0, autoConfirmed: 0, needsReview: 0 })) };
    const prepopulation = { prepopulate: jest.fn(async () => ({ ldaClientIds: [], issueCodesAdded: 0 })) };
    const service = new ClientsService(
      prisma as never,
      config as never,
      entityResolution as never,
      prepopulation as never,
    );
    return { service, tenantTx };
  };

  test('excludes soft-archived ("deleted") clients by default', async () => {
    const { service, tenantTx } = makeService();

    await service.list(ctx);

    expect(tenantTx.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { not: 'archived' } } }),
    );
  });

  test('includes archived clients only when includeArchived is set', async () => {
    const { service, tenantTx } = makeService();

    await service.list(ctx, { includeArchived: true });

    // No status filter is added → the where clause stays empty.
    expect(tenantTx.client.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  test('keeps profileStatus/sectorTag filters alongside the archived exclusion', async () => {
    const { service, tenantTx } = makeService();

    await service.list(ctx, { profileStatus: 'ACTIVE', sectorTag: 'defense' });

    expect(tenantTx.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { profileStatus: 'ACTIVE', sectorTag: 'defense', status: { not: 'archived' } },
      }),
    );
  });
});
