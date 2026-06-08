import { describe, expect, jest, test } from '@jest/globals';
import { ProgramElementReadService } from './program-element-read.service.js';

/**
 * Step 3.1 — getOpportunitiesForPe ordering + shape + exclusion contract.
 *
 * Self-contained mock prisma (only samOpportunityMatch.findMany is exercised) so the shared
 * makePrisma in program-element-read.service.spec.ts is left untouched. Asserts:
 *   - notices are ordered by responseDeadline ASC, NULL deadlines LAST
 *   - the OpportunityItem shape (notice metadata + procurement POC, lifted from the join)
 *   - the read FILTERS to reviewStatus in (accepted, candidate) AND active=true — i.e.
 *     quarantined/rejected and inactive notices are excluded at the query level
 */

interface FakeMatchRow {
  matchBasis: string;
  reviewStatus: string;
  confidence: number;
  opportunity: {
    id: string;
    noticeId: string;
    title: string;
    noticeType: string;
    agency: string | null;
    office: string | null;
    pscCode: string | null;
    naicsCode: string | null;
    postedDate: Date | null;
    responseDeadline: Date | null;
    sourceUrl: string | null;
    pocName: string | null;
    pocEmail: string | null;
  };
}

function makePrisma(rows: FakeMatchRow[]) {
  const findMany = jest.fn(async (_args: unknown) => rows);
  return {
    prisma: { samOpportunityMatch: { findMany } },
    findMany,
  };
}

function makeService(prisma: unknown) {
  // ConferenceProbabilityService + relevanceService are unused on this path; pass stubs.
  return new ProgramElementReadService(prisma as never, { predict: jest.fn() } as never);
}

function opp(over: Partial<FakeMatchRow['opportunity']> = {}): FakeMatchRow['opportunity'] {
  return {
    id: 'opp',
    noticeId: 'SAM-1',
    title: 'A notice',
    noticeType: 'Solicitation',
    agency: 'Department of the Army',
    office: 'ACC-RSA',
    pscCode: '1410',
    naicsCode: '336414',
    postedDate: new Date('2026-05-01T00:00:00.000Z'),
    responseDeadline: null,
    sourceUrl: 'https://sam.gov/opp/x',
    pocName: 'Jane Contracting',
    pocEmail: 'jane@army.mil',
    ...over,
  };
}

describe('ProgramElementReadService.getOpportunitiesForPe (Step 3.1)', () => {
  const rows: FakeMatchRow[] = [
    {
      matchBasis: 'program_alias',
      reviewStatus: 'candidate',
      confidence: 0.6,
      opportunity: opp({
        id: 'no-deadline',
        noticeId: 'SAM-ND',
        responseDeadline: null,
      }),
    },
    {
      matchBasis: 'description_pe_code',
      reviewStatus: 'accepted',
      confidence: 0.99,
      opportunity: opp({
        id: 'closes-later',
        noticeId: 'SAM-LATE',
        responseDeadline: new Date('2026-08-01T00:00:00.000Z'),
      }),
    },
    {
      matchBasis: 'office',
      reviewStatus: 'candidate',
      confidence: 0.55,
      opportunity: opp({
        id: 'closes-soon',
        noticeId: 'SAM-SOON',
        responseDeadline: new Date('2026-06-15T00:00:00.000Z'),
      }),
    },
  ];

  test('orders by responseDeadline ascending with NULL deadlines last', async () => {
    const { prisma } = makePrisma(rows);
    const service = makeService(prisma);

    const result = await service.getOpportunitiesForPe('0604801F');

    // soonest -> later -> undated.
    expect(result.map((r) => r.id)).toEqual(['closes-soon', 'closes-later', 'no-deadline']);
  });

  test('returns the full OpportunityItem shape (notice metadata + procurement POC)', async () => {
    const { prisma } = makePrisma([rows[1]!]);
    const service = makeService(prisma);

    const result = await service.getOpportunitiesForPe('0604801F');

    expect(result[0]).toEqual({
      id: 'closes-later',
      noticeId: 'SAM-LATE',
      title: 'A notice',
      noticeType: 'Solicitation',
      agency: 'Department of the Army',
      office: 'ACC-RSA',
      pscCode: '1410',
      naicsCode: '336414',
      postedDate: new Date('2026-05-01T00:00:00.000Z'),
      responseDeadline: new Date('2026-08-01T00:00:00.000Z'),
      sourceUrl: 'https://sam.gov/opp/x',
      pocName: 'Jane Contracting',
      pocEmail: 'jane@army.mil',
      matchBasis: 'description_pe_code',
      reviewStatus: 'accepted',
      confidence: 0.99,
    });
  });

  test('query EXCLUDES quarantined/rejected + inactive notices (accepted/candidate, active=true)', async () => {
    const { prisma, findMany } = makePrisma(rows);
    const service = makeService(prisma);

    await service.getOpportunitiesForPe('0604801F');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          peCode: '0604801F',
          reviewStatus: { in: ['accepted', 'candidate'] },
          opportunity: { is: { active: true } },
        },
      }),
    );
  });

  test('blank peCode short-circuits to [] (no query)', async () => {
    const { prisma, findMany } = makePrisma(rows);
    const service = makeService(prisma);

    expect(await service.getOpportunitiesForPe('   ')).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
