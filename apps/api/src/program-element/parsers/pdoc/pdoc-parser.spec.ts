import { describe, expect, jest, test } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PDocParserService,
  parseProcurementPes,
  parseNum,
  pdocSource,
  type ProcurementPeRecord,
} from './pdoc-parser.service.js';
import { PDocLineExtractorService } from './pdoc-line-extractor.service.js';

const fixturesDir = path.resolve(process.cwd(), 'scripts/__fixtures__');
function readJson(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));
}

describe('parseNum', () => {
  test('parses qty/dollars incl comma, dollar, negative', () => {
    expect(parseNum('1,320,000')).toBe(1320000);
    expect(parseNum('$110,000,000')).toBe(110000000);
    expect(parseNum('(500)')).toBe(-500);
    expect(parseNum('')).toBeNull();
    expect(parseNum(12)).toBe(12);
  });
});

describe('pdocSource', () => {
  test('builds per-service tag', () => {
    expect(pdocSource('ARMY', 2027)).toBe('p_doc_army_fy27');
    expect(pdocSource('NAVY', 2027)).toBe('p_doc_navy_fy27');
    expect(pdocSource('AF', 2027)).toBe('p_doc_af_fy27');
  });
});

describe('parseProcurementPes — fixture matches golden', () => {
  test('army-aircraft-procurement-sample parses to golden records', () => {
    const fixture = readJson('army-aircraft-procurement-sample.rows.json') as { fy: number; pes: Record<string, unknown>[] };
    const golden = readJson('army-aircraft-procurement-sample.golden.json') as { records: ProcurementPeRecord[] };
    const parsed = parseProcurementPes(fixture.pes as never, { fy: fixture.fy, service: 'ARMY' });
    expect(parsed).toEqual(golden.records);
  });
});

describe('PDocLineExtractorService', () => {
  test('drops description-less rows, defaults FY', () => {
    const ex = new PDocLineExtractorService();
    const lines = ex.extract(
      [
        { description: 'Airframe', quantity: '12', dollars: '960,000' },
        { description: '', quantity: '1', dollars: '5' },
        { quantity: '2', dollars: '10' },
      ],
      2027,
    );
    expect(lines).toEqual([{ description: 'Airframe', fy: 2027, quantity: 12, dollars: 960000, unitCost: null }]);
  });
});

interface CapturedLine {
  where: { peCode_lineDescription_fy: { peCode: string; lineDescription: string; fy: number } };
  create: { peCode: string; lineDescription: string; dollars: number | null };
}

function makeService(opts?: { changedPeCodes?: string[] }) {
  const pes: Array<{ record: { peCode: string; appropriationType?: string }; source: string }> = [];
  const years: Array<{ peCode: string; fy: number; source: string }> = [];
  const lines: CapturedLine[] = [];
  const quarantines: Array<{ source: string }> = [];
  const changed = new Set(opts?.changedPeCodes ?? []);

  const writer = {
    upsertProgramElement: jest.fn(async (record: { peCode: string }, source: string) => {
      pes.push({ record, source });
      return { inserted: true };
    }),
    upsertProgramElementYear: jest.fn(async (record: { peCode: string; fy: number }, source: string) => {
      years.push({ peCode: record.peCode, fy: record.fy, source });
      return { inserted: true, changed: changed.has(record.peCode) };
    }),
    quarantine: jest.fn(async (_raw: unknown, _reason: string, source: string) => {
      quarantines.push({ source });
    }),
  };

  const prisma = {
    programElementProcurementLine: {
      upsert: jest.fn(async (args: CapturedLine) => {
        lines.push(args);
        return {};
      }),
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test injection
  const svc = new PDocParserService(writer as any, prisma as any);
  return { svc, writer, prisma, pes, years, lines, quarantines };
}

const goldenRecords = (
  readJson('army-aircraft-procurement-sample.golden.json') as { records: ProcurementPeRecord[] }
).records;

describe('PDocParserService.load', () => {
  test('parent PE → writer (PROC + p_doc source); child lines → procurement_line; bad PE quarantined', async () => {
    const { svc, pes, lines, quarantines } = makeService();
    const result = await svc.load(goldenRecords, 'ARMY', 2027, 'https://example.gov/apa.pdf');

    // 2 valid parents upserted (BADPROC99 quarantined).
    expect(result.pesUpserted).toBe(2);
    expect(result.quarantined).toBe(1);
    expect(quarantines[0]?.source).toBe('p_doc_army_fy27');

    for (const p of pes) {
      expect(p.source).toBe('p_doc_army_fy27');
      expect(p.record.appropriationType).toBe('PROC');
    }

    // 5 child line items total (3 + 2), all hierarchy-keyed by parent pe_code.
    expect(result.lineItemsUpserted).toBe(5);
    expect(lines.every((l) => ['0204134N', '0204136A'].includes(l.where.peCode_lineDescription_fy.peCode))).toBe(true);
    const airframe = lines.find((l) => l.where.peCode_lineDescription_fy.lineDescription === 'Airframe')!;
    expect(airframe.where.peCode_lineDescription_fy.peCode).toBe('0204134N');
    expect(airframe.create.dollars).toBe(960000);
  });

  test('no cross-service contamination: NAVY load tags every record NAVY + p_doc_navy', async () => {
    const navyRecords = goldenRecords
      .filter((r) => r.peCode !== 'BADPROC99')
      .map((r) => ({ ...r, service: 'NAVY' as const }));
    const { svc, pes } = makeService();
    await svc.load(navyRecords, 'NAVY', 2027);
    expect(pes.length).toBe(2);
    expect(pes.every((p) => p.source === 'p_doc_navy_fy27')).toBe(true);
  });

  test('idempotent — re-load with no writer year-deltas reports 0 changed', async () => {
    const { svc } = makeService({ changedPeCodes: [] });
    const result = await svc.load(goldenRecords, 'ARMY', 2027);
    expect(result.pesUpserted).toBe(2);
    expect(result.pesChanged).toBe(0);
  });
});
