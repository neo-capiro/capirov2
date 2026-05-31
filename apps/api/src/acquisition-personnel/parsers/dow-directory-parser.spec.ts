import { describe, expect, test } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  DowDirectoryExtractionClient,
  DowDirectoryParserService,
  DowDirectorySectionExtraction,
} from './dow-directory-parser.service.js';
import { DowDirectorySectionChunk } from './dow-directory-section-splitter.service.js';

const SAMPLE_PDF = path.resolve('src/acquisition-personnel/parsers/__fixtures__/dow-directory-section-sample.pdf');
const GOLDEN_JSON = path.resolve('src/acquisition-personnel/parsers/__fixtures__/dow-directory-golden.json');

type WriterInput = {
  fullName: string;
  title?: string | null;
  organization?: string | null;
  role?: string | null;
  service?: string | null;
  emailDomain?: string | null;
  metadata?: Record<string, unknown>;
  peCodesMentioned?: string[];
};

describe('DowDirectoryParserService', () => {
  test('fixture parse meets acceptance behaviors and rerun is idempotent', async () => {
    const pdfBuffer = await fs.readFile(SAMPLE_PDF);
    const golden = JSON.parse(await fs.readFile(GOLDEN_JSON, 'utf-8')) as DowDirectorySectionExtraction;

    const extractionCache = new Map<string, { response: DowDirectorySectionExtraction; credits: number }>();
    const people = new Map<string, { id: string; record: WriterInput }>();
    const sourceMentions = new Set<string>();
    const quarantine: Array<{ reason: string; record: unknown; source: string }> = [];
    const syncRuns: Array<Record<string, unknown>> = [];
    const vacancyEvents: Array<Record<string, unknown>> = [];
    const storedDomains: string[] = [];

    let personSeq = 0;

    const writer = {
      upsertPerson: async (
        record: WriterInput,
        source: string,
        sourceUrl: string | undefined,
        _snippet: string | undefined,
        observedAt: Date,
        confidence: number,
      ) => {
        const key = `${record.fullName.toLowerCase()}|${(record.organization ?? '').toLowerCase()}|${(record.title ?? '').toLowerCase()}`;
        const mentionKey = (personId: string) => `${personId}|${source}|${sourceUrl ?? ''}|${observedAt.toISOString()}|${confidence}`;

        const existing = people.get(key);
        if (existing) {
          const mk = mentionKey(existing.id);
          if (!sourceMentions.has(mk)) sourceMentions.add(mk);
          return { inserted: false, person_id: existing.id, mergedWith: existing.id };
        }

        const id = `p-${++personSeq}`;
        people.set(key, { id, record });
        sourceMentions.add(mentionKey(id));
        if (record.emailDomain) storedDomains.push(record.emailDomain);
        return { inserted: true, person_id: id };
      },
      quarantine: async (rawRecord: unknown, reason: string, source: string) => {
        quarantine.push({ reason, record: rawRecord, source });
      },
    };

    class MockExtractionClient implements DowDirectoryExtractionClient {
      public calls = 0;
      async extractSection(_params: { section: DowDirectorySectionChunk; sectionPdf: Buffer; sourcePdfPresignedUrl: string }) {
        this.calls += 1;
        return { result: golden, creditsConsumed: 120 };
      }
    }

    const extractionClient = new MockExtractionClient();

    const splitter = {
      splitIntoSections: async (_pdf: Buffer): Promise<DowDirectorySectionChunk[]> => [
        {
          title: 'Sample Section',
          organization: 'Sample Section Org',
          pageStart: 1,
          pageEnd: 12,
          buffer: pdfBuffer,
        },
      ],
    };

    const prisma = {
      syncRun: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `sr-${syncRuns.length + 1}`, ...data };
          syncRuns.push(row);
          return row;
        },
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const idx = syncRuns.findIndex((r) => r.id === where.id);
          if (idx >= 0) syncRuns[idx] = { ...syncRuns[idx], ...data };
          return syncRuns[idx];
        },
      },
      programElement: {
        findUnique: async ({ where }: { where: { peCode: string } }) => {
          if (where.peCode === '0012345A') return { peCode: where.peCode };
          return null;
        },
      },
      intelligenceChange: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          vacancyEvents.push(data);
          return data;
        },
      },
      $executeRawUnsafe: async (sql: string, ...args: unknown[]) => {
        if (/INSERT INTO extraction_cache/i.test(sql)) {
          const key = `${args[0]}|${args[1]}|${args[2]}`;
          extractionCache.set(key, {
            response: JSON.parse(String(args[3])) as DowDirectorySectionExtraction,
            credits: Number(args[4]),
          });
        }
        return 1;
      },
      $queryRawUnsafe: async (_sql: string, ...args: unknown[]) => {
        const key = `${args[0]}|${args[1]}|${args[2]}`;
        const hit = extractionCache.get(key);
        if (!hit) return [];
        return [{ response_jsonb: hit.response, credits_consumed: hit.credits }];
      },
    };

    const parser = new DowDirectoryParserService(prisma as never, writer as never, splitter as never, extractionClient);
    (parser as unknown as { uploadPdfCacheIfMissing: () => Promise<void> }).uploadPdfCacheIfMissing = async () => undefined;
    (parser as unknown as { getCachedPdfReadUrl: () => Promise<string> }).getCachedPdfReadUrl = async () => 'https://example.com/fake.pdf';
    (parser as unknown as { withSectionFragment: (baseUrl: string, pageStart: number, pageEnd: number) => string }).withSectionFragment =
      (baseUrl: string, pageStart: number, pageEnd: number) => `${baseUrl}#page=${pageStart}&endPage=${pageEnd}`;

    const first = await parser.parseDirectory({
      pdfPath: SAMPLE_PDF,
      pdfBuffer,
      sourceVersion: 'dow_directory_update_4_2026_01',
    });

    const second = await parser.parseDirectory({
      pdfPath: SAMPLE_PDF,
      pdfBuffer,
      sourceVersion: 'dow_directory_update_4_2026_01',
    });

    const totalExpected = golden.personnel.length;
    const processed = first.persons_inserted + first.persons_quarantined;
    const accuracy = processed / totalExpected;

    expect(accuracy).toBeGreaterThanOrEqual(0.95);
    expect(first.sections_processed).toBe(1);
    expect(first.total_firecrawl_credits_consumed).toBe(120);
    expect(first.vacancies_detected).toBeGreaterThanOrEqual(1);

    expect(second.persons_inserted).toBe(0);
    expect(second.persons_addSourceMentioned).toBe(0);
    expect(second.total_firecrawl_credits_consumed).toBe(0);
    expect(extractionClient.calls).toBe(1);

    expect(quarantine.some((q) => q.reason === 'low_confidence_extraction')).toBe(true);
    expect(quarantine.some((q) => q.reason === 'invalid_name')).toBe(true);

    expect(vacancyEvents.length).toBeGreaterThanOrEqual(1);

    expect(storedDomains.some((d) => d.includes('@'))).toBe(false);
    expect(storedDomains).toContain('us.army.mil');

    const alice = Array.from(people.values()).find((p) => p.record.fullName.includes('Alice Example'));
    expect(alice).toBeTruthy();
    expect((alice?.record.peCodesMentioned as unknown[] | undefined) ?? []).toEqual([]);
  }, 120000);
});
