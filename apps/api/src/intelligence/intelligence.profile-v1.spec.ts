import { NotFoundException } from '@nestjs/common';
import { IntelligenceService } from './intelligence.service.js';

describe('IntelligenceService.getClientProfileV1', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const clientId = '00000000-0000-0000-0000-000000000010';

  const makeService = () => {
    const tenantTx = {
      client: {
        findFirst: jest.fn(async () => ({ id: clientId, name: 'Acme Defense' })),
        findMany: jest.fn(async () => [{ id: clientId }]),
      },
      clientIntelMapping: {
        findMany: jest.fn(async () => []),
        // Compute-on-read alert builders (getContractAwardAlerts,
        // getCompetitorLdaAlerts) read confirmed mappings via withTenant(tx).
        findFirst: jest.fn(async () => null),
      },
      meeting: {
        findMany: jest.fn(async () => []),
      },
      mailThread: {
        findMany: jest.fn(async () => []),
      },
      engagementTask: {
        findMany: jest.fn(async () => []),
      },
      meetingDebrief: {
        findMany: jest.fn(async () => []),
      },
      outreachRecord: {
        findMany: jest.fn(async () => []),
      },
    };

    const prisma: any = {
      withTenant: jest.fn(async (_tenantId: string, run: (tx: any) => Promise<any>) => run(tenantTx)),
      clientIntelMapping: {
        count: jest.fn(async () => 0),
      },
      intelligenceChange: {
        findMany: jest.fn(async () => []),
      },
      meeting: {
        findMany: jest.fn(async () => []),
      },
      mailThread: {
        findMany: jest.fn(async () => []),
      },
      engagementTask: {
        findMany: jest.fn(async () => []),
      },
      meetingDebrief: {
        findMany: jest.fn(async () => []),
      },
      outreachRecord: {
        findMany: jest.fn(async () => []),
      },
      committeeHearing: {
        findMany: jest.fn(async () => []),
      },
      $queryRaw: jest.fn(async () => []),
      $queryRawUnsafe: jest.fn(async () => []),
      $executeRawUnsafe: jest.fn(async () => 0),
    };

    const service = new IntelligenceService(prisma);

    jest.spyOn(service as any, 'getClientProfile').mockResolvedValue({
      lda: {
        matched: false,
        yearlySpend: [],
        totalSpend: 0,
        totalSpending: 0,
        totalFilings: 0,
      },
      contracting: {
        matched: false,
        yearlySpend: [],
        totalObligations: 0,
      },
      lobbyIntel: {
        matched: false,
        trajectory: null,
        growthRate: null,
        totalSpending: 0,
      },
    } as any);

    jest.spyOn(service as any, 'computeEngagementHealth').mockResolvedValue({
      score: 0,
      trend: 'stable',
      confidence: 0,
      components: {
        recency: 0,
        engagementVolume: 0,
        completionRate: 0,
      },
    } as any);

    jest.spyOn(service as any, 'getLobbyingRoi').mockResolvedValue({
      mappedLdaClientId: null,
      lobbySpend: 0,
      contractWins: 0,
      roi: null,
      gap: 0,
    });

    jest.spyOn(service as any, 'buildRoiQuarterSeries').mockResolvedValue([]);
    jest.spyOn(service as any, 'getFecMoneyFlow').mockResolvedValue({ mappedEmployer: null, summary: {} });
    jest.spyOn(service as any, 'getDistrictNexus').mockResolvedValue({ topDistricts: [], capabilities: [] });
    jest.spyOn(service as any, 'getTrackedBills').mockResolvedValue({ total: 0, issueCodes: [], bills: [] });
    jest.spyOn(service as any, 'getBillRegulationLinks').mockResolvedValue({ links: [], totalBills: 0, totalRegulations: 0 });
    jest.spyOn(service as any, 'getKnowledgeGraph').mockResolvedValue({
      resolutionQuality: { avgConfidence: 0, confirmedCount: 0, unconfirmedCount: 0 },
      nodes: [],
      edges: [],
    });
    jest.spyOn(service as any, 'getExStaffers').mockResolvedValue({ total: 0, lobbyists: [] });
    jest.spyOn(service as any, 'getCommentPeriodAlerts').mockResolvedValue({ alerts: [] });

    return { service, prisma, tenantTx };
  };

  test('returns profile-v1 shape for mapped client without throwing', async () => {
    const { service } = makeService();

    const payload = await service.getClientProfileV1(clientId, tenantId);

    expect(payload.client).toEqual({ id: clientId, name: 'Acme Defense' });
    expect(payload.sections).toBeDefined();
    expect(payload.sections.snapshot).toBeDefined();
    expect(payload.sections.financialFootprint).toBeDefined();
    expect(payload.sections.legislativeRegulatory).toBeDefined();
    expect(payload.sections.relationships).toBeDefined();
  });

  test('treats a soft-archived ("deleted") client as not-found', async () => {
    const { service, tenantTx } = makeService();
    // The guard query is the first client.findFirst call; archived → 404 so a
    // deleted client's alerts can never surface (e.g. via a stale deep link).
    tenantTx.client.findFirst.mockResolvedValueOnce({
      id: clientId,
      name: 'Acme Defense',
      status: 'archived',
    } as any);

    await expect(service.getClientProfileV1(clientId, tenantId)).rejects.toThrow(NotFoundException);
  });

  test('returns safe defaults for partially mapped client payloads', async () => {
    const { service } = makeService();

    (service as any).getTrackedBills.mockResolvedValueOnce({
      total: 3,
      issueCodes: ['DEF'],
      bills: [
        {
          identifier: '118-hr-1',
          title: 'Defense Authorization Act',
          latestActionDate: new Date('2026-01-01T00:00:00.000Z'),
          latestActionText: 'Referred to committee',
          sponsorName: 'Rep. Smith',
          sponsorParty: 'R',
          subjectNames: ['Defense'],
          congress: 118,
          billType: 'hr',
          billNumber: '1',
          introducedDate: new Date('2026-01-01T00:00:00.000Z'),
          cosponsorsCount: 7,
        },
      ],
    });

    const payload = await service.getClientProfileV1(clientId, tenantId);

    expect(payload.sections.legislativeRegulatory.kanban.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(payload.sections.legislativeRegulatory.kanban.columns)).toBe(true);
    expect(payload.sections.snapshot.changes7dCount).toBeGreaterThanOrEqual(0);
    expect(payload.links).toBeDefined();
  });

  test('throws NotFoundException when client does not exist in tenant', async () => {
    const { service, prisma } = makeService();
    prisma.withTenant.mockImplementationOnce(async (_tenantId: string, run: (tx: any) => Promise<any>) =>
      run({
        client: {
          findFirst: jest.fn(async () => null),
          findMany: jest.fn(async () => []),
        },
        clientIntelMapping: {
          findMany: jest.fn(async () => []),
        },
        meeting: {
          findMany: jest.fn(async () => []),
        },
        mailThread: {
          findMany: jest.fn(async () => []),
        },
        engagementTask: {
          findMany: jest.fn(async () => []),
        },
        meetingDebrief: {
          findMany: jest.fn(async () => []),
        },
        outreachRecord: {
          findMany: jest.fn(async () => []),
        },
      }),
    );

    await expect(service.getClientProfileV1(clientId, tenantId)).rejects.toBeInstanceOf(NotFoundException);
  });
});
