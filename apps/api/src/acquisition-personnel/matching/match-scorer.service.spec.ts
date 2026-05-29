import { describe, expect, test } from '@jest/globals';
import { MatchScorerService } from './match-scorer.service.js';

function createService(rows: Array<Record<string, unknown>>) {
  const prisma = {
    $queryRaw: async (...args: unknown[]) => {
      const text = String((args[0] as { strings?: readonly string[] })?.strings?.[0] ?? '');
      if (text.includes('SELECT similarity(')) {
        return [{ score: 1 }];
      }
      return rows;
    },
  };
  return new MatchScorerService(prisma as never);
}

describe('MatchScorerService', () => {
  test('same name + org + similar title scores > 0.92', async () => {
    const service = createService([
      {
        personId: 'p1',
        fullName: 'John Smith',
        nameKey: 'smith john',
        organization: 'PEO Missiles & Space',
        title: 'Program Manager, Alpha',
        emailDomain: 'army.mil',
        programOfRecord: 'ALPHA',
        pePrimary: '0603270A',
        peSecondary: [],
        nameSimilarity: 0.98,
      },
    ]);

    const out = await service.findMatches({
      fullName: 'MAJ John Smith',
      organization: 'PEO Missiles & Space',
      title: 'Deputy Program Manager, Alpha',
      emailDomain: 'army.mil',
      programs: ['ALPHA'],
      peCodesMentioned: ['0603270A'],
    });

    expect(out[0]?.score ?? 0).toBeGreaterThan(0.92);
  });

  test('same name different org scores in review band', async () => {
    const service = createService([
      {
        personId: 'p2',
        fullName: 'John Smith',
        nameKey: 'smith john',
        organization: 'PEO Ground Combat Systems',
        title: 'Program Manager',
        emailDomain: null,
        programOfRecord: null,
        pePrimary: null,
        peSecondary: [],
        nameSimilarity: 0.75,
      },
    ]);

    const out = await service.findMatches({
      fullName: 'John Smith',
      organization: 'NAVAIR',
      title: 'Contracting Officer',
      emailDomain: 'navy.mil',
    });

    expect(out[0]?.score ?? 0).toBeGreaterThanOrEqual(0.5);
    expect(out[0]?.score ?? 0).toBeLessThanOrEqual(0.7);
  });

  test('same name same org incompatible titles scores in review band', async () => {
    const service = createService([
      {
        personId: 'p3',
        fullName: 'Jane Doe',
        nameKey: 'doe jane',
        organization: 'PEO Aviation',
        title: 'Program Executive Officer',
        emailDomain: 'army.mil',
        programOfRecord: null,
        pePrimary: null,
        peSecondary: [],
        nameSimilarity: 0.74,
      },
    ]);

    const out = await service.findMatches({
      fullName: 'Jane Doe',
      organization: 'PEO Aviation',
      title: 'Junior Contract Specialist',
      emailDomain: 'navy.mil',
    });

    expect(out[0]?.score ?? 0).toBeGreaterThanOrEqual(0.5);
    expect(out[0]?.score ?? 0).toBeLessThanOrEqual(0.7);
  });

  test('different names with low name similarity + org mismatch remain low', async () => {
    const service = createService([
      {
        personId: 'p4',
        fullName: 'Alice Brown',
        nameKey: 'brown alice',
        organization: 'PEO Aviation',
        title: 'Program Manager',
        emailDomain: null,
        programOfRecord: null,
        pePrimary: null,
        peSecondary: [],
        nameSimilarity: 0.65,
      },
    ]);

    const out = await service.findMatches({
      fullName: 'John Smith',
      organization: 'NAVAIR',
      title: 'Contract Specialist',
      emailDomain: 'navy.mil',
    });

    expect(out[0]?.score ?? 1).toBeLessThan(0.66);
  });

  test('promotion case MAJ PM -> LTC PM scores > 0.92', async () => {
    const service = createService([
      {
        personId: 'p5',
        fullName: 'John Smith',
        nameKey: 'smith john',
        organization: 'PM Alpha',
        title: 'Program Manager, Alpha',
        emailDomain: 'army.mil',
        programOfRecord: 'ALPHA',
        pePrimary: '0603270A',
        peSecondary: [],
        nameSimilarity: 0.99,
      },
    ]);

    const out = await service.findMatches({
      fullName: 'LTC John Smith',
      organization: 'PM Alpha',
      title: 'Deputy Program Manager, Alpha',
      emailDomain: 'army.mil',
      programs: ['ALPHA'],
      peCodesMentioned: ['0603270A'],
    });

    expect(out[0]?.score ?? 0).toBeGreaterThan(0.92);
  });

  test('jaccardOverlap pure helper works', () => {
    const service = createService([]);
    expect(service.jaccardOverlap(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3, 5);
  });
});
