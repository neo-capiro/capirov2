import { describe, expect, jest, test } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DefenseAppropsReportParserService,
  appropsReportSource,
  parseExtractedRows,
  parseReportText,
  type DefenseAppropsMarkRecord,
} from './defense-approps-report-parser.service.js';

// Jest runs with cwd = apps/api; fixtures live under scripts/__fixtures__.
const fixturesDir = path.resolve(process.cwd(), 'scripts/__fixtures__');

function readJson(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));
}

describe('appropsReportSource', () => {
  test('builds HAC-D / SAC-D + fy tag', () => {
    expect(appropsReportSource('HAC-D', 2027)).toBe('hac_d_report_fy27');
    expect(appropsReportSource('SAC-D', 2027)).toBe('sac_d_report_fy27');
  });
});

describe('parseExtractedRows — fixture matches golden', () => {
  test('HRPT-119-DEFENSE-APPROPS-sample rows parse to the golden records', () => {
    const fixture = readJson('HRPT-119-DEFENSE-APPROPS-sample.rows.json') as { fy: number; rows: Record<string, unknown>[] };
    const golden = readJson('HRPT-119-DEFENSE-APPROPS-sample.golden.json') as { records: DefenseAppropsMarkRecord[] };

    const parsed = parseExtractedRows(fixture.rows as never, { fy: fixture.fy });
    expect(parsed).toEqual(golden.records);
  });
});

describe('parseReportText — extracts appropriations table rows', () => {
  test('PE rows with request + mark are parsed; prose mentions ignored', () => {
    const text = [
      'House Appropriations Committee, Defense Subcommittee FY2027',
      'PE Code   Request   Committee Mark   Explanation',
      '0603270A  125,000   140,000   Program increase',
      '0603250F  80,000    72,000    Unjustified growth reduction',
      'The committee notes PE 0604201A in prose; not a table row.',
    ].join('\n');

    const recs = parseReportText(text, { fy: 2027 });
    expect(recs.map((r) => r.peCode).sort()).toEqual(['0603250F', '0603270A']);
    const ew = recs.find((r) => r.peCode === '0603270A')!;
    expect(ew.request).toBe(125000);
    expect(ew.mark).toBe(140000);
  });
});

interface CapturedYear {
  record: { peCode: string; fy: number; hacDMark?: unknown; sacDMark?: unknown; request?: unknown };
  source: string;
}

function makeService(opts?: { changedPeCodes?: string[] }) {
  const upserts: CapturedYear[] = [];
  const quarantines: Array<{ reason: string; source: string }> = [];
  const changed = new Set(opts?.changedPeCodes ?? []);

  const writer = {
    upsertProgramElement: jest.fn(async (record: { peCode: string }) => ({
      inserted: true,
      pe_code: record.peCode,
    })),
    upsertProgramElementYear: jest.fn(async (record: CapturedYear['record'], source: string) => {
      upserts.push({ record, source });
      return { inserted: true, changed: changed.has(record.peCode) };
    }),
    quarantine: jest.fn(async (_raw: unknown, reason: string, source: string) => {
      quarantines.push({ reason, source });
    }),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test injection
  const svc = new DefenseAppropsReportParserService(writer as any);
  return { svc, writer, upserts, quarantines };
}

const goldenRecords = (
  readJson('HRPT-119-DEFENSE-APPROPS-sample.golden.json') as { records: DefenseAppropsMarkRecord[] }
).records;

describe('DefenseAppropsReportParserService.load', () => {
  test('HAC-D routes to hacDMark + hac_d source, quarantines bad pe_code', async () => {
    const { svc, upserts, quarantines } = makeService();
    const result = await svc.load(goldenRecords, 'HAC-D', 2027);

    expect(result.upserted).toBe(4);
    expect(result.quarantined).toBe(1);
    expect(quarantines[0]?.source).toBe('hac_d_report_fy27');

    for (const u of upserts) {
      expect(u.source).toBe('hac_d_report_fy27');
      expect(u.record.hacDMark).toBeDefined();
      expect(u.record.sacDMark).toBeUndefined();
    }
    const inc = upserts.find((u) => u.record.peCode === '0603270A')!;
    // Table value 140,000 (thousands) is normalized to 140 ($140M) at the boundary.
    expect(inc.record.hacDMark).toBe(140);
  });

  test('SAC-D routes to sacDMark + sac_d source', async () => {
    const { svc, upserts } = makeService();
    await svc.load(goldenRecords, 'SAC-D', 2027);
    const inc = upserts.find((u) => u.record.peCode === '0603270A')!;
    expect(inc.source).toBe('sac_d_report_fy27');
    expect(inc.record.sacDMark).toBe(140);
    expect(inc.record.hacDMark).toBeUndefined();
  });

  test('reports changed count from writer deltas (drives IntelligenceChange)', async () => {
    const { svc } = makeService({ changedPeCodes: ['0603270A', '0603250F'] });
    const result = await svc.load(goldenRecords, 'HAC-D', 2027);
    expect(result.changed).toBe(2);
  });

  test('idempotent — second load with no writer deltas reports 0 changed', async () => {
    const { svc } = makeService({ changedPeCodes: [] });
    const result = await svc.load(goldenRecords, 'HAC-D', 2027);
    expect(result.upserted).toBe(4);
    expect(result.changed).toBe(0);
  });
});
