import { InsightGeneratorService } from './insight-generator.service.js';

describe('InsightGeneratorService.generateClientBriefing PE section', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const clientId = '00000000-0000-0000-0000-000000000010';

  function makeService(options?: {
    peCodes?: string[];
    peChanges?: Array<{ peCode: string; severity: 'critical' | 'notable' | 'info'; billId?: string; docketId?: string }>;
    aiProgramElementStatus?: Array<{ peCode: string; severity?: 'critical' | 'notable' | 'info'; narrative: string }>;
    profileType?: string | null;
    sectorTag?: string | null;
    openaiModel?: string;
  }) {
    const peCodes = options?.peCodes ?? ['0603270A'];
    const peChanges = options?.peChanges ?? [
      {
        peCode: '0603270A',
        severity: 'notable' as const,
        billId: '119-hr-1234',
        docketId: 'DOD-2026-0001',
      },
    ];

    const client = {
      id: clientId,
      name: 'Acme Defense',
      description: 'Defense autonomy systems',
      capabilities: peCodes.map((code) => ({ name: `Cap ${code}`, peNumber: code })),
      submissionTracks: ['NDAA'],
      intakeData: { peNumber: peCodes[0] },
      profileType: options?.profileType ?? 'DEFENSE_SECTOR',
      sectorTag: options?.sectorTag ?? 'defense',
    };

    const peDetailRows = peCodes.map((code, idx) => ({
      peCode: code,
      title: `Program ${idx + 1}`,
      service: idx % 2 === 0 ? 'Army' : 'Air Force',
      years: [
        {
          fy: 2026,
          request: { toFixed: () => '120.00' },
          hascMark: { toFixed: () => '118.00' },
          sascMark: { toFixed: () => '121.00' },
          hacDMark: { toFixed: () => '117.00' },
          sacDMark: { toFixed: () => '119.00' },
        },
      ],
      conferenceProbabilities: [{ fy: 2026, predicted: { toFixed: () => '0.7300' } }],
    }));

    const peChangeRows = peChanges.map((change, idx) => ({
      id: `change-${idx}`,
      source: 'program_element',
      changeType: 'pe_mark_added',
      severity: change.severity,
      title: `Change ${idx + 1} for ${change.peCode}`,
      description: 'mark moved',
      relatedClientIds: [clientId],
      relatedIssues: [],
      relatedPeCodes: [change.peCode],
      data: {
        billId: change.billId,
        docketId: change.docketId,
      },
      detectedAt: new Date('2026-05-28T12:00:00.000Z'),
      consumed: false,
    }));

    const mockCallAi = jest.fn(async () => ({
      text: JSON.stringify({
        heroSummary: 'Daily snapshot.',
        whatsNew: [],
        whatsComing: [],
        suggestedActions: [],
        programElementStatus:
          options?.aiProgramElementStatus ??
          [
            {
              peCode: peCodes[0],
              severity: 'notable',
              narrative: `${peCodes[0]} is active in markup [${peCodes[0]}] [119-hr-1234] [DOD-2026-0001]`,
            },
          ],
      }),
      provider: 'openai',
      model: 'gpt-4o-mini',
    }));

    const prisma: any = {
      withTenant: jest.fn(async (_tenantId: string, run: (tx: any) => Promise<any>) =>
        run({
          client: {
            findFirst: jest.fn(async () => client),
          },
        }),
      ),
      clientIntelMapping: {
        findFirst: jest.fn(async () => null),
      },
      $queryRaw: jest.fn(async () => []),
      intelligenceChange: {
        findMany: jest.fn(async (args: any) => {
          if (args?.where?.relatedPeCodes) return peChangeRows;
          return [];
        }),
      },
      committeeHearing: {
        findMany: jest.fn(async () => []),
      },
      federalRegisterDocument: {
        findMany: jest.fn(async () => []),
      },
      programElement: {
        findMany: jest.fn(async () => peDetailRows),
      },
      congressBill: {
        findMany: jest.fn(async () => [
          {
            id: '119-hr-1234',
            title: 'Authorization Act',
            latestActionText: 'In markup',
            latestActionDate: new Date('2026-05-28T00:00:00.000Z'),
            peCodes,
          },
        ]),
      },
    };

    const config: any = {
      get: jest.fn((key: string) => {
        if (key === 'OPENAI_API_KEY') return 'test-openai-key';
        if (key === 'ANTHROPIC_API_KEY') return undefined;
        if (key === 'AI_PROVIDER') return 'openai';
        if (key === 'OPENAI_MODEL') return options?.openaiModel ?? 'gpt-4.1-mini';
        if (key === 'ANTHROPIC_MODEL') return 'claude-sonnet-4-20250514';
        return undefined;
      }),
    };

    const lobbyIntel: any = {
      getAiContext: jest.fn(async () => null),
    };

    const federalSpending: any = {
      getAiContext: jest.fn(async () => null),
    };

    const service = new InsightGeneratorService(config, prisma, lobbyIntel, federalSpending);
    jest.spyOn(service as any, 'callAi').mockImplementation(mockCallAi);

    return { service, prisma, mockCallAi };
  }

  test('mocked IntelligenceChange for watched PE includes Program Element status section with inline source markers', async () => {
    const { service } = makeService();

    const result = await service.generateClientBriefing(clientId, tenantId);

    expect(result.heroSummary).toContain('Program Element status:');
    expect(result.heroSummary).toContain('0603270A');
    expect(result.heroSummary).toContain('[0603270A]');
    expect(result.heroSummary).toContain('[119-hr-1234]');
    expect(result.heroSummary).toContain('[DOD-2026-0001]');
    expect((result as any).dataPoints.programElementStatus).toHaveLength(1);
  });

  test('no recent PE events means no Program Element status section', async () => {
    const { service } = makeService({ peChanges: [], aiProgramElementStatus: [] });

    const result = await service.generateClientBriefing(clientId, tenantId);

    expect(result.heroSummary).not.toContain('Program Element status:');
    expect((result as any).dataPoints).toBeUndefined();
  });

  test('multiple PEs produce one section per PE sorted by severity descending and only one LLM call', async () => {
    const { service, mockCallAi } = makeService({
      peCodes: ['0603270A', '0604220F'],
      peChanges: [
        { peCode: '0603270A', severity: 'info', billId: '119-hr-1000' },
        { peCode: '0604220F', severity: 'critical', docketId: 'DOD-CRIT-01' },
      ],
      aiProgramElementStatus: [
        {
          peCode: '0603270A',
          severity: 'info',
          narrative: 'Info-level movement [0603270A] [119-hr-1000]',
        },
        {
          peCode: '0604220F',
          severity: 'critical',
          narrative: 'Critical movement [0604220F] [DOD-CRIT-01]',
        },
      ],
      openaiModel: 'gpt-4.1',
    });

    const result = await service.generateClientBriefing(clientId, tenantId);

    expect((result as any).dataPoints.programElementStatus).toHaveLength(2);
    const lines = result.heroSummary.split('\n').filter((line) => line.includes('(') && line.includes('-'));
    expect(lines[0]).toContain('0604220F (critical)');
    expect(lines[1]).toContain('0603270A (info)');
    expect(mockCallAi).toHaveBeenCalledTimes(1);
    const callArgs = mockCallAi.mock.calls[0] as unknown[];
    expect(callArgs[3]).toBe('openai');
    expect(callArgs[4]).toBe('gpt-4o-mini');
  });
});
