import { IntelligenceService } from './intelligence.service.js';

/**
 * Unit tests for getSetupCompleteness — the per-client "what's filled in" score
 * that powers the Intelligence-tab setup nudge. Verifies the weighted score, the
 * LDA-keystone logic (a confirmed LDA mapping also satisfies issue codes), and
 * that internal weights are stripped from the payload.
 */
describe('IntelligenceService.getSetupCompleteness', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const clientId = '00000000-0000-0000-0000-000000000010';

  const make = (opts: {
    sectorTag?: string | null;
    issueCodes?: string[];
    confirmed?: string[];
    caps?: Array<{ tags?: unknown; description?: string | null }>;
  }) => {
    const tenantTx = {
      client: {
        findFirst: jest.fn(async () => ({
          id: clientId,
          sectorTag: opts.sectorTag ?? null,
          issueCodes: opts.issueCodes ?? [],
        })),
      },
      clientCapability: { findMany: jest.fn(async () => opts.caps ?? []) },
    };
    const prisma: any = {
      withTenant: jest.fn(async (_t: string, run: (tx: any) => Promise<any>) => run(tenantTx)),
      clientIntelMapping: {
        findMany: jest.fn(async () => (opts.confirmed ?? []).map((source) => ({ source }))),
      },
    };
    return new IntelligenceService(prisma);
  };

  test('empty client → not complete, low score, LDA gap, weights hidden', async () => {
    const r = await make({}).getSetupCompleteness(clientId, tenantId);
    expect(r.complete).toBe(false);
    expect(r.score).toBeLessThan(50);
    expect(r.checks.find((c) => c.key === 'lda')!.done).toBe(false);
    expect((r.checks[0] as Record<string, unknown>).weight).toBeUndefined();
  });

  test('a confirmed LDA mapping also satisfies the issue-codes check', async () => {
    const r = await make({ confirmed: ['lda'] }).getSetupCompleteness(clientId, tenantId);
    expect(r.checks.find((c) => c.key === 'lda')!.done).toBe(true);
    expect(r.checks.find((c) => c.key === 'issue_codes')!.done).toBe(true);
  });

  test('client-level issue codes satisfy issue-codes without an LDA mapping', async () => {
    const r = await make({ issueCodes: ['DEF'] }).getSetupCompleteness(clientId, tenantId);
    expect(r.checks.find((c) => c.key === 'lda')!.done).toBe(false);
    expect(r.checks.find((c) => c.key === 'issue_codes')!.done).toBe(true);
  });

  test('fully set up → complete, score 100', async () => {
    const r = await make({
      sectorTag: 'DEFENSE',
      issueCodes: ['DEF'],
      confirmed: ['lda', 'contracting', 'fec_employer'],
      caps: [{ tags: ['hypersonics'], description: 'Long-range strike capability.' }],
    }).getSetupCompleteness(clientId, tenantId);
    expect(r.complete).toBe(true);
    expect(r.score).toBe(100);
  });
});
