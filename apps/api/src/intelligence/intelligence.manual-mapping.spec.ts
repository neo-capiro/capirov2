import { IntelligenceService } from './intelligence.service.js';

/**
 * Manual LDA mapping: searchLdaClients (free-text / by-id lookup that powers the
 * attach panel) and createManualMapping (pins an exact lda_client.id as a
 * confirmed mapping — the reliable, name-independent way to fold a registrant
 * variant the fuzzy matcher can't reach into a client's footprint).
 */
describe('IntelligenceService — manual LDA mapping', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const clientId = '00000000-0000-0000-0000-000000000010';

  describe('searchLdaClients', () => {
    test('empty query short-circuits to [] without hitting the DB', async () => {
      const $queryRaw = jest.fn();
      const service = new IntelligenceService({ $queryRaw } as any);
      expect(await service.searchLdaClients('   ')).toEqual([]);
      expect($queryRaw).not.toHaveBeenCalled();
    });

    test('maps raw rows to the typed shape (id as string, numeric stats)', async () => {
      const $queryRaw = jest.fn(async () => [
        {
          id: 4321,
          name: 'RAYTHEON TECHNOLOGIES CORPORATION',
          state: 'VA',
          total_filings: 180,
          latest_filing_year: 2026,
          total_spending: 90000000,
          issue_codes: ['DEF', 'AVI'],
          similarity: 0.31,
        },
      ]);
      const service = new IntelligenceService({ $queryRaw } as any);
      const out = await service.searchLdaClients('raytheon');
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({
        id: '4321',
        name: 'RAYTHEON TECHNOLOGIES CORPORATION',
        state: 'VA',
        totalFilings: 180,
        latestFilingYear: 2026,
        totalSpending: 90000000,
        issueCodes: ['DEF', 'AVI'],
      });
      expect(typeof out[0]!.id).toBe('string');
    });

    test('a numeric query is allowed (exact-id lookup path)', async () => {
      const $queryRaw = jest.fn(async () => []);
      const service = new IntelligenceService({ $queryRaw } as any);
      await service.searchLdaClients('4321');
      expect($queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('createManualMapping', () => {
    const input = {
      source: 'lda',
      externalId: '4321',
      externalName: 'RAYTHEON TECHNOLOGIES CORPORATION',
    };

    test('pins an exact id as a confirmed mapping (confidence=1)', async () => {
      const upsert = jest.fn(async (args: any) => ({ id: 'm1', ...args.create }));
      const prisma: any = {
        withTenant: jest.fn(async (_t: string, run: (tx: any) => Promise<any>) =>
          run({ client: { findFirst: jest.fn(async () => ({ id: clientId })) } }),
        ),
        clientIntelMapping: { upsert },
      };
      const service = new IntelligenceService(prisma);
      await service.createManualMapping(clientId, tenantId, input);
      expect(upsert).toHaveBeenCalledTimes(1);
      const args = upsert.mock.calls[0]![0];
      expect(args.create).toMatchObject({
        clientId,
        source: 'lda',
        externalId: '4321',
        confirmed: true,
        confidence: 1,
      });
      expect(args.update).toMatchObject({ confirmed: true });
    });

    test('rejects a client outside the tenant', async () => {
      const upsert = jest.fn();
      const prisma: any = {
        withTenant: jest.fn(async (_t: string, run: (tx: any) => Promise<any>) =>
          run({ client: { findFirst: jest.fn(async () => null) } }),
        ),
        clientIntelMapping: { upsert },
      };
      const service = new IntelligenceService(prisma);
      await expect(service.createManualMapping(clientId, tenantId, input)).rejects.toThrow(
        'Client not found',
      );
      expect(upsert).not.toHaveBeenCalled();
    });
  });
});
