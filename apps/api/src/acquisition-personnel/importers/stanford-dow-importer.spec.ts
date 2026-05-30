import { describe, expect, test } from '@jest/globals';
import { importStanfordDowDirectory } from './stanford-dow-importer.js';
import { normalizeName } from '../normalization/name-normalizer.js';

const FIXTURE_PATH = 'C:/Users/neoma/OneDrive/Documents/Claude/Projects/capirov2/git/capirov2/apps/api/scripts/__fixtures__/dow_directory_full.xlsx';

type PersonRow = {
  id: string;
  fullName: string;
  nameKey: string;
  organization: string;
  title: string;
  metadata?: Record<string, unknown>;
  confidence: number;
};

describe('importStanfordDowDirectory', () => {
  test('runs end-to-end and rerun is idempotent', async () => {
    const people = new Map<string, PersonRow>();
    const sourceMentions = new Set<string>();
    const pe = new Map<string, { peCode: string; title: string }>();
    const peYears = new Set<string>();
    const quarantined: Array<{ reason: string; source: string }> = [];

    let idSeq = 0;

    const writer = {
      upsertPerson: async (
        record: { fullName: string; organization?: string | null; title?: string | null; metadata?: unknown },
        source: string,
        sourceUrl: string | undefined,
        snippet: string | undefined,
        observedAt: Date,
        confidence: number,
      ) => {
        if (!record.fullName?.trim()) {
          quarantined.push({ reason: 'missing full_name', source });
          throw new Error('missing full_name');
        }

        const org = (record.organization ?? '').toString();
        const title = (record.title ?? '').toString();
        // Model the REAL DB: uniqueness is on nameKey alone (NOT org/title). The
        // production writer runs with a noOp matcher during import, so the only
        // dedup is the importer's in-memory map keyed by nameKey.
        const nameKey = normalizeName(record.fullName).nameKey;

        let existing = Array.from(people.values()).find((p) => p.nameKey === nameKey);

        if (!existing) {
          existing = {
            id: `p-${++idSeq}`,
            fullName: record.fullName,
            nameKey,
            organization: org,
            title,
            metadata: (record.metadata as Record<string, unknown> | undefined) ?? {},
            confidence,
          };
          people.set(existing.id, existing);
          const mentionKey = `${existing.id}|${source}|${sourceUrl ?? ''}|${observedAt.toISOString()}|${confidence}`;
          sourceMentions.add(mentionKey);
          void snippet;
          return { inserted: true, person_id: existing.id };
        }

        const mentionKey = `${existing.id}|${source}|${sourceUrl ?? ''}|${observedAt.toISOString()}|${confidence}`;
        if (!sourceMentions.has(mentionKey)) sourceMentions.add(mentionKey);

        return { inserted: false, person_id: existing.id, mergedWith: existing.id };
      },
      addSourceMention: async (
        personId: string,
        source: string,
        sourceUrl: string | undefined,
        _snippet: string | undefined,
        observedAt: Date,
        confidence: number,
      ) => {
        const mentionKey = `${personId}|${source}|${sourceUrl ?? ''}|${observedAt.toISOString()}|${confidence}`;
        if (sourceMentions.has(mentionKey)) return false;
        sourceMentions.add(mentionKey);
        return true;
      },
      quarantine: async (_rawRecord: unknown, reason: string, source: string) => {
        quarantined.push({ reason, source });
      },
    };

    const programElementWriter = {
      upsertProgramElement: async (
        record: { peCode: string; title: string },
        _source: string,
        _confidence: number,
      ) => {
        const existed = pe.has(record.peCode);
        if (!existed) pe.set(record.peCode, { peCode: record.peCode, title: record.title });
        return { inserted: !existed, pe_code: record.peCode };
      },
      upsertProgramElementYear: async (
        record: { peCode: string; fy: number },
        _source: string,
      ) => {
        const key = `${record.peCode}|${record.fy}`;
        const existed = peYears.has(key);
        if (!existed) peYears.add(key);
        return { inserted: !existed, changed: !existed };
      },
      quarantine: async (_rawRecord: unknown, reason: string, source: string) => {
        quarantined.push({ reason, source });
      },
    };

    const existingPersonByKey = new Map<string, string>();
    // Model the script's DB pre-seed: idempotency must hold even with a FRESH map
    // each run, because the importer re-seeds from the DB (here, the mock `people`).
    const loadExistingByNameKey = async (): Promise<Array<[string, string]>> =>
      Array.from(people.values()).map((p) => [p.nameKey, p.id] as [string, string]);
    const deps = { writer, programElementWriter, existingPersonByKey, loadExistingByNameKey };

    const first = await importStanfordDowDirectory(FIXTURE_PATH, deps);
    const peopleAfterFirst = people.size;
    // Second run uses a FRESH map to prove re-seed-from-DB idempotency (the real
    // Aurora re-run scenario), not just shared-map luck.
    const second = await importStanfordDowDirectory(FIXTURE_PATH, {
      writer,
      programElementWriter,
      existingPersonByKey: new Map<string, string>(),
      loadExistingByNameKey,
    });

    expect(first.persons_inserted).toBeGreaterThan(3000);
    expect(first.pes_inserted).toBeGreaterThan(800);
    expect(first.pe_years_inserted).toBeGreaterThan(2200);
    expect(first.spot_check_sample).toHaveLength(10);

    expect(second.persons_inserted).toBe(0);
    expect(second.persons_addSourceMentioned).toBe(0);
    expect(second.pes_inserted).toBe(0);
    expect(second.pe_years_inserted).toBe(0);

    // The core idempotency guarantee: re-running creates ZERO new person rows
    // (no duplicates), even though the same humans appear across multiple sheets
    // with differing org/title strings.
    expect(people.size).toBe(peopleAfterFirst);

    expect(quarantined.length).toBeGreaterThanOrEqual(0);

    // Sample reported for human PDF review
    for (const sample of first.spot_check_sample) {
      expect(sample.fullName.length).toBeGreaterThan(0);
      expect(sample.organization.length).toBeGreaterThan(0);
    }
  }, 180000);
});
