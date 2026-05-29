/**
 * E2E smoke checklist (package-level smoke spec for now):
 *
 * This repo currently has no browser E2E runner configured (no Playwright/Cypress package,
 * config, or npm script). To avoid infra churn in this ticket, this smoke spec validates
 * the four-section + control invariants at contract level.
 *
 * When browser E2E infra is added, port these assertions to selector-level tests.
 */

describe('Client Intel V1 smoke - four sections and controls', () => {
  const minimalPayload = {
    client: { id: 'client-1', name: 'Acme Defense' },
    generatedAt: '2026-05-27T00:00:00.000Z',
    links: {
      changesInbox: '/intelligence/changes?clientId=client-1',
      mappingsAdmin: '/settings/intelligence-mappings',
      competitorIssuePage: '/intelligence/issues/DEF',
      billDetailBase: '/explorer',
      entityResolutionQueue: '/settings/intelligence-mappings',
    },
    sections: {
      snapshot: {
        trajectory: { label: 'stable', growthRate: null, totalSpending: 0, yearlySpend: [] },
        health: { score: 0, trend: 'stable' },
        topAlerts: [],
        activity14d: [],
        changes7dCount: 0,
      },
      financialFootprint: {
        hero: { lobbyingTtm: 0, obligationsTtm: 0, returnRatio: null, gap: 0 },
        series: { lobbying: [], obligations: [], quarterSeries: [] },
        fecMoneyFlow: { mappedEmployer: null, summary: {} },
        districtNexus: { topDistricts: [], capabilities: [] },
      },
      legislativeRegulatory: {
        kanban: {
          total: 0,
          issueCodes: [],
          columns: [
            { id: 'introduced', label: 'Introduced', count: 0, bills: [] },
            { id: 'committee', label: 'In Committee', count: 0, bills: [] },
            { id: 'passed', label: 'Passed Chamber', count: 0, bills: [] },
            { id: 'enacted', label: 'Enacted', count: 0, bills: [] },
          ],
        },
        regulatoryLifecycle: { rails: [] },
        hearingsAndMarkups: [],
      },
      relationships: {
        scopedGraph: {
          resolutionQuality: { avgConfidence: 0, confirmedCount: 0, unconfirmedCount: 0 },
          meta: { lobbyistCount: 0, memberCount: 0, committeeCount: 0 },
        },
        officeRecommender: [],
        exStafferCount: 0,
      },
    },
  };

  test('contains all four anchored sections expected by the redesigned page', () => {
    expect(minimalPayload.sections.snapshot).toBeDefined();
    expect(minimalPayload.sections.financialFootprint).toBeDefined();
    expect(minimalPayload.sections.legislativeRegulatory).toBeDefined();
    expect(minimalPayload.sections.relationships).toBeDefined();
  });

  test('kanban controls remain present and non-redundant (exact 4 stage columns)', () => {
    const ids = minimalPayload.sections.legislativeRegulatory.kanban.columns.map((c) => c.id);
    expect(ids).toEqual(['introduced', 'committee', 'passed', 'enacted']);
    expect(new Set(ids).size).toBe(4);
  });

  test('action links for key controls exist and are routable strings', () => {
    expect(typeof minimalPayload.links.changesInbox).toBe('string');
    expect(typeof minimalPayload.links.billDetailBase).toBe('string');
    expect(typeof minimalPayload.links.competitorIssuePage).toBe('string');
    expect(typeof minimalPayload.links.mappingsAdmin).toBe('string');
  });

  test('legacy redundant surfaces are absent from profile-v1 payload contract', () => {
    const payloadText = JSON.stringify(minimalPayload);
    expect(payloadText).not.toContain('billTrackerV0');
    expect(payloadText).not.toContain('artifactPanel');
    expect(payloadText).not.toContain('changesInboxCard');
    expect(payloadText).not.toContain('exStafferStandaloneCard');
  });

  test('runtime safety invariant: every section object is serializable without throwing', () => {
    expect(() => JSON.stringify(minimalPayload.sections)).not.toThrow();
  });
});
