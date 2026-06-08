import { ConfigService } from '@nestjs/config';
import { WhitePaperService } from './whitepaper.service.js';
import type { WhitePaperSection } from './whitepaper.types.js';

/**
 * Construct the service with stubbed Prisma + Config (no DB, no network) and
 * exercise the pure logic paths. This proves the @Injectable constructs with
 * its real dependency shape and that lint/variant logic behaves.
 */
function makeService(): WhitePaperService {
  const prisma = {} as never;
  const config = {
    get: (key: string) => {
      if (key === 'OPENAI_MODEL') return 'gpt-4.1-mini';
      return undefined;
    },
  } as unknown as ConfigService<never, true>;
  return new WhitePaperService(prisma, config);
}

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
        { id: 'sec-1', heading: 'Problem Statement', body: 'A genuine capability gap exists in the fleet.' },
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
});
