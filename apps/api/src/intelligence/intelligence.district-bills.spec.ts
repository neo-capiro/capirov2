import { IntelligenceService } from './intelligence.service.js';

/**
 * Unit tests for the two behaviours added alongside the District Nexus spend
 * wiring and the manual bill-tracking mechanism:
 *
 *   1. getClientProfileV1 prefers REAL spend-by-district (getDistrictNexusSpend)
 *      for topDistricts, and falls back to the free-text capability parse
 *      (getDistrictNexus) only when spend produced no district rows.
 *   2. getTrackedBills ALWAYS surfaces manually pinned bills (even when they
 *      don't clear the embedding similarity floor / there are no auto terms),
 *      flags them isManual, and de-dupes a pin that also auto-matched.
 */
describe('IntelligenceService — district spend wiring + manual bill tracking', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const clientId = '00000000-0000-0000-0000-000000000010';

  // ── Shared profile-v1 harness (mirrors intelligence.profile-v1.spec.ts) ──
  const makeProfileService = () => {
    const tenantTx = {
      client: {
        findFirst: jest.fn(async () => ({ id: clientId, name: 'Acme Defense' })),
        findMany: jest.fn(async () => [{ id: clientId }]),
      },
      clientIntelMapping: { findMany: jest.fn(async () => []) },
      meeting: { findMany: jest.fn(async () => []) },
      mailThread: { findMany: jest.fn(async () => []) },
      engagementTask: { findMany: jest.fn(async () => []) },
      meetingDebrief: { findMany: jest.fn(async () => []) },
      outreachRecord: { findMany: jest.fn(async () => []) },
    };

    const prisma: any = {
      withTenant: jest.fn(async (_t: string, run: (tx: any) => Promise<any>) => run(tenantTx)),
      clientIntelMapping: { count: jest.fn(async () => 0) },
      intelligenceChange: { findMany: jest.fn(async () => []) },
      meeting: { findMany: jest.fn(async () => []) },
      mailThread: { findMany: jest.fn(async () => []) },
      engagementTask: { findMany: jest.fn(async () => []) },
      meetingDebrief: { findMany: jest.fn(async () => []) },
      outreachRecord: { findMany: jest.fn(async () => []) },
      committeeHearing: { findMany: jest.fn(async () => []) },
      $queryRaw: jest.fn(async () => []),
      $queryRawUnsafe: jest.fn(async () => []),
      $executeRawUnsafe: jest.fn(async () => 0),
    };

    const service = new IntelligenceService(prisma);

    jest.spyOn(service as any, 'getClientProfile').mockResolvedValue({
      lda: { matched: false, yearlySpend: [], totalSpend: 0, totalSpending: 0, totalFilings: 0 },
      contracting: { matched: false, yearlySpend: [], totalObligations: 0 },
      lobbyIntel: { matched: false, trajectory: null, growthRate: null, totalSpending: 0 },
    } as any);
    jest.spyOn(service as any, 'computeEngagementHealth').mockResolvedValue({
      score: 0, trend: 'stable', confidence: 0,
      components: { recency: 0, engagementVolume: 0, completionRate: 0 },
    } as any);
    jest.spyOn(service as any, 'getLobbyingRoi').mockResolvedValue({
      mappedLdaClientId: null, lobbySpend: 0, contractWins: 0, roi: null, gap: 0,
    });
    jest.spyOn(service as any, 'buildRoiQuarterSeries').mockResolvedValue([]);
    jest.spyOn(service as any, 'getFecMoneyFlow').mockResolvedValue({ mappedEmployer: null, summary: {} });
    jest.spyOn(service as any, 'getTrackedBills').mockResolvedValue({ total: 0, issueCodes: [], bills: [] });
    jest.spyOn(service as any, 'getBillRegulationLinks').mockResolvedValue({ links: [], totalBills: 0, totalRegulations: 0 });
    jest.spyOn(service as any, 'getKnowledgeGraph').mockResolvedValue({
      resolutionQuality: { avgConfidence: 0, confirmedCount: 0, unconfirmedCount: 0 }, nodes: [], edges: [],
    });
    jest.spyOn(service as any, 'getExStaffers').mockResolvedValue({ total: 0, lobbyists: [] });
    jest.spyOn(service as any, 'getCommentPeriodAlerts').mockResolvedValue({ alerts: [] });

    return { service };
  };

  describe('getClientProfileV1 — district nexus source selection', () => {
    test('uses REAL spend-by-district for topDistricts when spend is linked', async () => {
      const { service } = makeProfileService();

      // Free-text path returns a (lower-priority) capability district.
      jest.spyOn(service as any, 'getDistrictNexus').mockResolvedValue({
        capabilities: [
          {
            capabilityId: 'cap-1',
            capabilityName: 'Shipbuilding',
            capabilitySector: 'DEFENSE',
            districtNexus: 'VA-02',
            districts: [{ state: 'VA', district: '2', dataYear: 2023 }],
            talkingPoints: [],
            totalSupportedJobs: 500,
          },
        ],
      });

      // Spend path returns real USAspending dollars by district — should win.
      jest.spyOn(service as any, 'getDistrictNexusSpend').mockResolvedValue({
        linked: true,
        contractorNames: ['ACME DEFENSE INC'],
        totalAwards: 12,
        totalAmount: 9_500_000,
        districtCount: 2,
        unmappedAmount: 0,
        districts: [
          { district: 'TX-23', state: 'TX', districtNumber: '23', awardCount: 8, totalAmount: 6_000_000, demographics: { dataYear: 2023 } },
          { district: 'CA-12', state: 'CA', districtNumber: '12', awardCount: 4, totalAmount: 3_500_000, demographics: { dataYear: 2023 } },
        ],
        disclaimer: 'x',
      });

      const payload = await service.getClientProfileV1(clientId, tenantId);
      const top = payload.sections.financialFootprint.districtNexus.topDistricts;

      // Spend rows win: sorted by spend desc, carrying spend + awardCount.
      expect(top.map((d: { district: string }) => d.district)).toEqual(['TX-23', 'CA-12']);
      expect(top[0]).toMatchObject({ district: 'TX-23', spend: 6_000_000, awardCount: 8 });
      expect(top[1]).toMatchObject({ district: 'CA-12', spend: 3_500_000, awardCount: 4 });
      // The free-text capability district (VA-02) must NOT appear.
      expect(top.some((d: { district: string }) => d.district === 'VA-02')).toBe(false);
    });

    test('falls back to free-text capability districts when spend is unlinked', async () => {
      const { service } = makeProfileService();

      jest.spyOn(service as any, 'getDistrictNexus').mockResolvedValue({
        capabilities: [
          {
            capabilityId: 'cap-1',
            capabilityName: 'Shipbuilding',
            capabilitySector: 'DEFENSE',
            districtNexus: 'VA-02',
            districts: [{ state: 'VA', district: '2', dataYear: 2023 }],
            talkingPoints: [],
            totalSupportedJobs: 500,
          },
        ],
      });

      // No confirmed contracting mapping → spend path returns linked:false.
      jest.spyOn(service as any, 'getDistrictNexusSpend').mockResolvedValue({
        linked: false,
        reason: 'no_confirmed_contracting_mapping',
        contractorNames: [],
        totalAwards: 0,
        totalAmount: 0,
        districts: [],
        unmappedAmount: 0,
        disclaimer: 'x',
      });

      const payload = await service.getClientProfileV1(clientId, tenantId);
      const top = payload.sections.financialFootprint.districtNexus.topDistricts;

      // Free-text builder composes `${state}-${district}` from the raw district
      // number (no zero-padding), so the mock's district:'2' yields 'VA-2'.
      expect(top.map((d: { district: string }) => d.district)).toEqual(['VA-2']);
      expect(top[0]).toMatchObject({ district: 'VA-2', jobs: 500 });
    });

    test('falls back to free-text when spend is linked but has zero-dollar districts', async () => {
      const { service } = makeProfileService();

      jest.spyOn(service as any, 'getDistrictNexus').mockResolvedValue({
        capabilities: [
          {
            capabilityId: 'cap-1',
            capabilityName: 'Cyber',
            capabilitySector: 'DEFENSE',
            districtNexus: 'MD-03',
            districts: [{ state: 'MD', district: '3', dataYear: 2023 }],
            talkingPoints: [],
            totalSupportedJobs: 120,
          },
        ],
      });

      // Linked, but every award rolled into the unmapped bucket (no district $).
      jest.spyOn(service as any, 'getDistrictNexusSpend').mockResolvedValue({
        linked: true,
        contractorNames: ['ACME'],
        totalAwards: 3,
        totalAmount: 1000,
        districtCount: 0,
        unmappedAmount: 1000,
        districts: [
          { district: 'XX-0', state: 'XX', districtNumber: '0', awardCount: 0, totalAmount: 0, demographics: null },
        ],
        disclaimer: 'x',
      });

      const payload = await service.getClientProfileV1(clientId, tenantId);
      const top = payload.sections.financialFootprint.districtNexus.topDistricts;

      // Zero-dollar spend rows are filtered out → fall back to capability text.
      expect(top.map((d: { district: string }) => d.district)).toEqual(['MD-3']);
    });
  });

  describe('getTrackedBills — manual bill tracking merge', () => {
    const billRow = (id: string, title: string) => ({
      id,
      title,
      latest_action_date: new Date('2026-01-01T00:00:00.000Z'),
      latest_action_text: 'Referred to committee',
      sponsor_name: 'Rep. Smith',
      sponsor_party: 'R',
      subjects: ['Defense'],
    });

    const makeBillService = (manualBillIds: string[], queryRows: Record<string, any[]>) => {
      const tenantTx = {
        trackedBill: { findMany: jest.fn(async () => manualBillIds.map((billId) => ({ billId }))) },
        clientCapability: { findMany: jest.fn(async () => []) },
      };
      const prisma: any = {
        withTenant: jest.fn(async (_t: string, run: (tx: any) => Promise<any>) => run(tenantTx)),
        clientIntelMapping: { findFirst: jest.fn(async () => null) }, // no LDA mapping
        // $queryRaw is used for fetchBillsByIds; route by call shape.
        $queryRaw: jest.fn(async () => queryRows.fetchByIds ?? []),
        $queryRawUnsafe: jest.fn(async () => queryRows.embeddings ?? []),
      };
      const service = new IntelligenceService(prisma);
      return { service };
    };

    test('surfaces manual pins even with no auto-match terms, flagged isManual', async () => {
      // No LDA mapping + no capabilities → allTerms empty → no auto matches.
      // Manual pin must still appear, flagged isManual.
      const { service } = makeBillService(
        ['119-hr-1234'],
        { fetchByIds: [billRow('119-hr-1234', 'Manually Pinned Act')] },
      );

      const result = await service.getTrackedBills(clientId, tenantId);

      expect(result.total).toBe(1);
      expect(result.bills).toHaveLength(1);
      expect(result.bills[0]).toMatchObject({ identifier: '119-hr-1234', isManual: true });
    });

    test('flags an auto-matched bill that is also manually pinned (no duplicate)', async () => {
      // Auto match (via embeddings) returns 119-hr-1234; same bill is manually
      // pinned. It must appear once, flagged isManual — not duplicated.
      const { service } = makeBillService(['119-hr-1234'], {
        embeddings: [{ source_id: '119-hr-1234', score: 0.91 }],
        // fetchBillsByIds is called for BOTH the embeddings hydrate and the
        // missing-manual hydrate; return the same row for any id query.
        fetchByIds: [billRow('119-hr-1234', 'Defense Auth Act')],
      });

      // Force the embeddings path to be taken by giving it a term.
      jest.spyOn(service as any, 'findTrackedBillsByEmbeddings').mockResolvedValue({
        total: 1,
        bills: [
          {
            identifier: '119-hr-1234',
            title: 'Defense Auth Act',
            latestActionDate: new Date('2026-01-01T00:00:00.000Z'),
            latestActionText: 'Referred to committee',
            sponsorName: 'Rep. Smith',
            sponsorParty: 'R',
            subjectNames: ['Defense'],
          },
        ],
      });
      // Provide terms so the embeddings branch runs.
      jest.spyOn(service as any, 'getManualTrackedBillIds').mockResolvedValue(['119-hr-1234']);

      // getTrackedBills needs at least one term to reach the embeddings branch;
      // stub capability keywords by spying on the tenant capability read is
      // already empty, so inject a term via the LDA issue path instead:
      (service as any).prisma.clientIntelMapping.findFirst = jest.fn(async () => ({
        externalId: '1',
      }));
      (service as any).prisma.$queryRaw = jest.fn(async (strings: any) => {
        const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
        if (sql.includes('issue_codes')) return [{ issue_codes: ['DEF'] }];
        if (sql.includes('lda_issue_code')) return [{ name: 'Defense' }];
        return [];
      });

      const result = await service.getTrackedBills(clientId, tenantId);

      const ids = result.bills.map((b) => b.identifier);
      expect(ids.filter((id) => id === '119-hr-1234')).toHaveLength(1);
      expect(result.bills.find((b) => b.identifier === '119-hr-1234')).toMatchObject({ isManual: true });
    });

    test('manual pin is included alongside a distinct auto-matched bill', async () => {
      const { service } = makeBillService(['119-hr-9999'], {
        fetchByIds: [billRow('119-hr-9999', 'Pinned Bill')],
      });

      // Auto path returns a DIFFERENT bill; manual pin should be added on top.
      jest.spyOn(service as any, 'findTrackedBillsByEmbeddings').mockResolvedValue({
        total: 1,
        bills: [
          {
            identifier: '119-hr-1111',
            title: 'Auto Matched Bill',
            latestActionDate: new Date('2026-02-01T00:00:00.000Z'),
            latestActionText: 'Passed House',
            sponsorName: 'Rep. Jones',
            sponsorParty: 'D',
            subjectNames: ['Defense'],
          },
        ],
      });
      jest.spyOn(service as any, 'getManualTrackedBillIds').mockResolvedValue(['119-hr-9999']);
      (service as any).prisma.clientIntelMapping.findFirst = jest.fn(async () => ({ externalId: '1' }));
      (service as any).prisma.$queryRaw = jest.fn(async (strings: any) => {
        const sql = Array.isArray(strings) ? strings.join(' ') : String(strings);
        if (sql.includes('issue_codes')) return [{ issue_codes: ['DEF'] }];
        if (sql.includes('lda_issue_code')) return [{ name: 'Defense' }];
        // fetchBillsByIds for the missing manual id.
        return [billRow('119-hr-9999', 'Pinned Bill')];
      });

      const result = await service.getTrackedBills(clientId, tenantId);
      const byId = new Map(result.bills.map((b) => [b.identifier, b]));

      expect(byId.has('119-hr-1111')).toBe(true);
      expect(byId.has('119-hr-9999')).toBe(true);
      expect(byId.get('119-hr-9999')).toMatchObject({ isManual: true });
      expect(byId.get('119-hr-1111')).toMatchObject({ isManual: false });
      expect(result.total).toBe(2);
    });
  });
});
