import { ConfigService } from '@nestjs/config';
import { WhitePaperService } from './whitepaper.service.js';
import type { WhitePaperSection } from './whitepaper.types.js';

/**
 * Construct the service with stubbed Prisma + Config (no DB, no network) and
 * exercise the pure logic paths. This proves the @Injectable constructs with
 * its real dependency shape and that lint/variant logic behaves.
 */
function makeConfig(): ConfigService<never, true> {
  return {
    get: (key: string) => {
      if (key === 'OPENAI_MODEL') return 'gpt-4.1-mini';
      return undefined;
    },
  } as unknown as ConfigService<never, true>;
}

function makeService(): WhitePaperService {
  const prisma = {} as never;
  return new WhitePaperService(prisma, makeConfig());
}

/**
 * Prisma stub that returns a default empty model delegate for any model not
 * explicitly overridden, so contextCandidates can be exercised without a DB.
 */
function makePrisma(models: Record<string, unknown>): never {
  const base = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
  });
  return new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (!(prop in models)) models[prop] = base();
        return models[prop];
      },
    },
  ) as never;
}

function makeServiceWithPrisma(models: Record<string, unknown>): WhitePaperService {
  return new WhitePaperService(makePrisma(models), makeConfig());
}

const INSTANCE = {
  tenantId: 't1',
  clientId: 'c1',
  strategyId: 's1',
  strategy: {
    capability: {
      name: 'Widget System',
      description: 'A widget that fills a capability gap.',
      peNumbers: ['0603270A'],
      fundingAsk: 25_000_000,
    },
  },
};

const CLIENT = {
  id: 'c1',
  name: 'Acme Defense',
  description: 'A defense supplier.',
  productDescription: 'Widgets.',
  sectorTag: 'Defense',
  website: 'https://acme.test',
  issueCodes: ['DEF'],
  naicsCodes: [],
  pscCodes: [],
  submissionTracks: [],
  uei: 'ABC123',
  cageCode: '1A2B3',
  primaryContactEmail: 'jane@acme.test',
  ldaClientIds: [1],
};

describe('WhitePaperService (pure logic)', () => {
  it('exposes the three template variants', () => {
    const svc = makeService();
    const variants = svc.variants();
    expect(variants.map((v) => v.slug)).toEqual(
      expect.arrayContaining(['congressional_program', 'appropriations_brief', 'policy_position']),
    );
  });

  describe('lintSections', () => {
    it('flags bracket placeholders, empty sections, and missing ask', () => {
      const svc = makeService();
      const sections: WhitePaperSection[] = [
        { id: 'sec-1', heading: 'Problem Statement', body: 'Gap in [Program Name] capability.' },
        { id: 'sec-2', heading: 'Solution', body: '' },
      ];
      const result = svc.lintSections(sections, 'congressional_program');
      expect(result.issues.some((i) => /placeholder/i.test(i))).toBe(true);
      expect(result.issues.some((i) => /empty/i.test(i))).toBe(true);
      expect(result.issues.some((i) => /Ask/i.test(i))).toBe(true);
      expect(result.wordBudget).toBeGreaterThan(0);
    });

    it('passes a clean paper with an explicit ask', () => {
      const svc = makeService();
      const sections: WhitePaperSection[] = [
        {
          id: 'sec-1',
          heading: 'Problem Statement',
          body: 'A genuine capability gap exists in the fleet.',
        },
        { id: 'sec-2', heading: 'The Ask', body: 'We are requesting 25 million dollars in FY27.' },
      ];
      const result = svc.lintSections(sections, 'congressional_program');
      expect(result.issues).toHaveLength(0);
    });

    it('flags over-budget length', () => {
      const svc = makeService();
      const longBody = Array(700).fill('word').join(' ');
      const sections: WhitePaperSection[] = [
        { id: 'sec-1', heading: 'The Ask', body: `Requesting funds. ${longBody}` },
      ];
      const result = svc.lintSections(sections, 'appropriations_brief');
      expect(result.issues.some((i) => /exceeds/i.test(i))).toBe(true);
    });
  });

  describe('contextCandidates', () => {
    it('assembles a categorized catalog from many client sources', async () => {
      const svc = makeServiceWithPrisma({
        workflowInstance: {
          findUnique: jest.fn().mockResolvedValue(INSTANCE),
          findMany: jest.fn().mockResolvedValue([]),
        },
        client: { findFirst: jest.fn().mockResolvedValue(CLIENT) },
        clientPerson: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              {
                id: 'p1',
                name: 'Jane Doe',
                title: 'CEO',
                role: 'exec',
                email: 'jane@acme.test',
                updatedAt: new Date(),
              },
            ]),
        },
        clientFacility: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              {
                id: 'f1',
                name: 'Plant 1',
                city: 'Akron',
                state: 'OH',
                congressionalDistrict: '13',
                employeeCount: 400,
                updatedAt: new Date(),
              },
            ]),
        },
        engagementAttachment: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { id: 'a1', fileName: 'spec.pdf', contentType: 'application/pdf' },
            ]),
        },
        ldaFiling: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              {
                filingYear: 2025,
                income: 100000,
                expenses: null,
                registrantName: 'Lobby LLC',
                issueCodes: ['DEF'],
              },
            ]),
        },
        clientBrief: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              {
                id: 'b1',
                title: 'Hearing prep',
                body: 'Notes',
                sourceType: 'manual',
                updatedAt: new Date(),
              },
            ]),
        },
      });

      const candidates = await svc.contextCandidates('t1', 'wp1');
      const kinds = new Set(candidates.map((c) => c.kind));

      // Breadth: profile, program, federal, documents, intel all represented.
      expect(kinds).toContain('client_profile');
      expect(kinds).toContain('person');
      expect(kinds).toContain('facility');
      expect(kinds).toContain('capability');
      expect(kinds).toContain('program_element');
      expect(kinds).toContain('lda');
      expect(kinds).toContain('document');
      expect(kinds).toContain('client_brief');

      // Every candidate gets a category for grouping.
      expect(candidates.every((c) => Boolean(c.category))).toBe(true);

      // Documents are listed without text (resolved on demand) but carry refId.
      const doc = candidates.find((c) => c.kind === 'document');
      expect(doc?.refId).toBe('a1');
      expect(doc?.content).toBe('');

      // District nexus is surfaced from the facility.
      const facility = candidates.find((c) => c.kind === 'facility');
      expect(facility?.content).toMatch(/OH-13/);
    });

    it('is resilient: one failing source does not blank the catalog', async () => {
      const svc = makeServiceWithPrisma({
        workflowInstance: {
          findUnique: jest.fn().mockResolvedValue(INSTANCE),
          findMany: jest.fn().mockResolvedValue([]),
        },
        client: { findFirst: jest.fn().mockResolvedValue(CLIENT) },
        // People source blows up — the rest must still resolve.
        clientPerson: { findMany: jest.fn().mockRejectedValue(new Error('boom')) },
      });

      const candidates = await svc.contextCandidates('t1', 'wp1');
      expect(candidates.some((c) => c.kind === 'client_profile')).toBe(true);
      expect(candidates.some((c) => c.kind === 'capability')).toBe(true);
    });

    it('rejects an instance from another tenant', async () => {
      const svc = makeServiceWithPrisma({
        workflowInstance: {
          findUnique: jest.fn().mockResolvedValue({ ...INSTANCE, tenantId: 'other' }),
        },
      });
      await expect(svc.contextCandidates('t1', 'wp1')).rejects.toThrow();
    });
  });
});
