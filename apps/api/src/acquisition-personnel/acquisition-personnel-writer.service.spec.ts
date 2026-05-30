import { describe, expect, test } from '@jest/globals';
import { AcquisitionPersonnelWriterService, MissingRequiredFieldError } from './acquisition-personnel-writer.service.js';

function createService(matchScore = 0) {
  const personnel = new Map<string, Record<string, unknown>>();
  const sources: Array<Record<string, unknown>> = [];
  const quarantineRows: Array<Record<string, unknown>> = [];
  const mergeCandidates: Array<Record<string, unknown>> = [];

  let seq = 0;
  const nextId = () => `person-${++seq}`;

  const prisma: {
    acquisitionPersonnel: {
      create: ({ data }: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
      findUnique: ({ where }: { where: { id: string } }) => Promise<Record<string, unknown> | null>;
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
      delete: ({ where }: { where: { id: string } }) => Promise<void>;
    };
    acquisitionPersonnelSource: {
      findFirst: ({ where }: { where: { personId: string; source: string; sourceUrl: string | null } }) => Promise<Record<string, unknown> | null>;
      findMany: ({ where }: { where: { personId: string } }) => Promise<Array<{ confidence: number }>>;
      create: ({ data }: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
      update: ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Promise<void>;
      updateMany: ({ where, data }: { where: { personId: string }; data: Record<string, unknown> }) => Promise<void>;
    };
    acquisitionPersonnelMergeCandidate: {
      create: ({ data }: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>;
      updateMany: () => Promise<{ count: number }>;
    };
    acquisitionPersonnelQuarantine: {
      create: ({ data }: { data: Record<string, unknown> }) => Promise<void>;
    };
    $transaction: (fn: (tx: typeof prisma) => Promise<void>) => Promise<void>;
  } = {
    acquisitionPersonnel: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextId();
        const row = { id, ...data };
        personnel.set(id, row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => personnel.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const current = personnel.get(where.id) ?? {};
        const next = { ...current, ...data };
        personnel.set(where.id, next);
        return next;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        personnel.delete(where.id);
      },
    },
    acquisitionPersonnelSource: {
      findFirst: async ({ where }: { where: { personId: string; source: string; sourceUrl: string | null } }) =>
        sources.find(
          (s) =>
            s.personId === where.personId &&
            s.source === where.source &&
            (s.sourceUrl ?? null) === (where.sourceUrl ?? null),
        ) ?? null,
      findMany: async ({ where }: { where: { personId: string } }) =>
        sources.filter((s) => s.personId === where.personId).map((s) => s as { confidence: number }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `src-${sources.length + 1}`, ...data };
        sources.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = sources.findIndex((s) => s.id === where.id);
        if (idx >= 0) sources[idx] = { ...sources[idx], ...data };
      },
      updateMany: async ({ where, data }: { where: { personId: string }; data: Record<string, unknown> }) => {
        for (let i = 0; i < sources.length; i += 1) {
          if (sources[i]?.personId === where.personId) sources[i] = { ...sources[i], ...data };
        }
      },
    },
    acquisitionPersonnelMergeCandidate: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        mergeCandidates.push(data);
        return data;
      },
      updateMany: async () => ({ count: 0 }),
    },
    acquisitionPersonnelQuarantine: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        quarantineRows.push(data);
      },
    },
    $transaction: async (fn: (tx: typeof prisma) => Promise<void>) => {
      await fn(prisma);
    },
  };

  const matchScorer = {
    findMatches: async () => {
      if (matchScore <= 0) return [];
      return [
        {
          personId: 'person-existing',
          score: matchScore,
          breakdown: {
            nameSimilarity: 0.9,
            orgSimilarity: 0.8,
            titleCompatibility: 0.8,
            emailDomainMatch: 0.5,
            programOverlap: 0,
          },
          reason: 'fixture',
        },
      ];
    },
  };

  const svc = new AcquisitionPersonnelWriterService(prisma as never, matchScorer as never);
  return { svc, personnel, sources, quarantineRows, mergeCandidates };
}

describe('AcquisitionPersonnelWriterService', () => {
  test('throws MissingRequiredFieldError on missing full_name and quarantines', async () => {
    const { svc, quarantineRows } = createService();

    await expect(
      svc.upsertPerson(
        { fullName: '' },
        'src-a',
        undefined,
        undefined,
        new Date('2026-01-01T00:00:00Z'),
        0.6,
      ),
    ).rejects.toBeInstanceOf(MissingRequiredFieldError);

    expect(quarantineRows).toHaveLength(1);
  });

  test('extracts domain from mailto and rejects malformed domain strings', async () => {
    const { svc, personnel } = createService();

    await svc.upsertPerson(
      {
        fullName: 'Jane Tester',
        email: 'mailto:jane.tester@army.mil',
      },
      'src-b',
      undefined,
      undefined,
      new Date('2026-01-02T00:00:00Z'),
      0.7,
    );

    const created = Array.from(personnel.values())[0] as Record<string, unknown>;
    expect(created.emailDomain).toBe('army.mil');

    await svc.upsertPerson(
      {
        fullName: 'John Invalid',
        emailDomain: 'http://example.com/path',
      },
      'src-c',
      undefined,
      undefined,
      new Date('2026-01-03T00:00:00Z'),
      0.7,
    );

    const rows = Array.from(personnel.values()) as Array<Record<string, unknown>>;
    const second = rows.find((r) => r.fullName === 'John Invalid');
    expect(second?.emailDomain ?? null).toBeNull();
  });
});
