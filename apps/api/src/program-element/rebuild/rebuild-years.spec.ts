import { describe, expect, test } from '@jest/globals';
import {
  assembleYearsFromSourceLog,
  normalizeLoggedValue,
  type SourceLogEntry,
} from './rebuild-years.js';

function entry(partial: Partial<SourceLogEntry> & Pick<SourceLogEntry, 'fieldName' | 'source' | 'valueDecimal'>): SourceLogEntry {
  return {
    peCode: '0603270A',
    fy: 2027,
    recordedAt: '2026-06-01T00:00:00.000Z',
    ...partial,
  };
}

describe('normalizeLoggedValue', () => {
  test('committee / public-law sources are full dollars -> millions (÷1e6)', () => {
    // Verified against live data: 0101224N enacted 60280000 = $60.3M.
    expect(normalizeLoggedValue(60280000, 'public_law_fy27')).toBe(60.28);
    expect(normalizeLoggedValue(931164000, 'hasc_report_fy27')).toBe(931.164);
    expect(normalizeLoggedValue(215322000, 'r_doc_army')).toBe(215.322);
  });

  test('P-doc procurement sources are thousands -> millions (÷1e3)', () => {
    expect(normalizeLoggedValue(150000, 'p_doc_army_fy27')).toBe(150);
  });

  test('fixture rows are already millions — never rescaled', () => {
    expect(normalizeLoggedValue(220.1, 'fixture')).toBe(220.1);
  });
});

describe('assembleYearsFromSourceLog', () => {
  test('unions every source field into one row, all normalized to millions', () => {
    const rebuilt = assembleYearsFromSourceLog([
      entry({ fieldName: 'request', source: 'r_doc_fy27', valueDecimal: 382000000 }),
      entry({ fieldName: 'hascMark', source: 'hasc_report_fy27', valueDecimal: 290000000 }),
      entry({ fieldName: 'conference', source: 'conference_report_fy27', valueDecimal: 286000000 }),
      // The clobber bug meant only this last source survived in the canonical row.
      entry({ fieldName: 'enacted', source: 'public_law_fy27', valueDecimal: 286000000 }),
    ]);

    expect(rebuilt).toHaveLength(1);
    const row = rebuilt[0]!;
    expect(row.peCode).toBe('0603270A');
    expect(row.fy).toBe(2027);
    expect(row.values).toEqual({ request: 382, hascMark: 290, conference: 286, enacted: 286 });
    expect(row.fieldSources.enacted).toBe('public_law_fy27');
    expect(row.sourceAttribution.enacted).toBe('Enacted public law');
    expect(row.sourceAttribution.request).toBe("President's Budget (R-2)");
    expect(row.datesAdded.enacted).toBe('2026-06-01');
  });

  test('per-field conflict: higher-priority source wins', () => {
    const rebuilt = assembleYearsFromSourceLog([
      entry({ fieldName: 'request', source: 'r_doc_fy27', valueDecimal: 100000000 }), // rank 5
      entry({ fieldName: 'request', source: 'conference_report_fy27', valueDecimal: 120000000 }), // rank 0 wins
    ]);
    expect(rebuilt[0]!.values.request).toBe(120);
    expect(rebuilt[0]!.sourceAttribution.request).toBe('NDAA conference');
  });

  test('per-field tie on same source → most recent recordedAt wins', () => {
    const rebuilt = assembleYearsFromSourceLog([
      entry({ fieldName: 'hascMark', source: 'hasc_report_fy27', valueDecimal: 200000000, recordedAt: '2026-01-01T00:00:00.000Z' }),
      entry({ fieldName: 'hascMark', source: 'hasc_report_fy27', valueDecimal: 210000000, recordedAt: '2026-02-01T00:00:00.000Z' }),
    ]);
    expect(rebuilt[0]!.values.hascMark).toBe(210);
  });

  test('ignores legacy __row__ audit rows and null values', () => {
    const rebuilt = assembleYearsFromSourceLog([
      entry({ fieldName: '__row__', source: 'public_law_fy27', valueDecimal: 999000000 }),
      entry({ fieldName: 'enacted', source: 'public_law_fy27', valueDecimal: null }),
      entry({ fieldName: 'request', source: 'r_doc_fy27', valueDecimal: 250000000 }),
    ]);
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]!.values).toEqual({ request: 250 });
  });

  test('separates distinct PE / FY combinations', () => {
    const rebuilt = assembleYearsFromSourceLog([
      entry({ peCode: '0603270A', fy: 2026, fieldName: 'enacted', source: 'public_law_fy26', valueDecimal: 224000000 }),
      entry({ peCode: '0603270A', fy: 2027, fieldName: 'request', source: 'r_doc_fy27', valueDecimal: 278500000 }),
      entry({ peCode: '0603250F', fy: 2027, fieldName: 'request', source: 'r_doc_fy27', valueDecimal: 382000000 }),
    ]);
    expect(rebuilt).toHaveLength(3);
    expect(rebuilt.map((r) => `${r.peCode}:${r.fy}`)).toEqual(['0603250F:2027', '0603270A:2026', '0603270A:2027']);
    expect(rebuilt.find((r) => r.peCode === '0603250F')!.values.request).toBe(382);
  });
});
