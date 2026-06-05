import { describe, expect, test } from '@jest/globals';
import {
  classifyPeRetire,
  decideLinkRepair,
  hasLiveSignal,
  type PeRetireSignals,
} from './pe-staleness.js';

const noSignals: PeRetireSignals = {
  source: 'stanford_pe_directory_jan2026',
  retiredAt: null,
  linkedActivePersonCount: 0,
  yearRowCount: 0,
  awardCount: 0,
  billCount: 0,
  watchCount: 0,
  capabilityCount: 0,
  procurementLineCount: 0,
  jbookCitationCount: 0,
  projectCount: 0,
};

describe('classifyPeRetire', () => {
  test('retires an old-spreadsheet PE with no live signal', () => {
    const d = classifyPeRetire(noSignals);
    expect(d.action).toBe('retire');
  });

  test('skips a PE that is not from the old spreadsheet (J-book relabeled it)', () => {
    const d = classifyPeRetire({ ...noSignals, source: 'dod_comptroller_r1_fy2027' });
    expect(d.action).toBe('skip');
    expect(d.reason).toBe('not_old_spreadsheet_pe');
  });

  test('skips a PE already retired', () => {
    const d = classifyPeRetire({ ...noSignals, retiredAt: new Date('2026-06-05T00:00:00Z') });
    expect(d.action).toBe('skip');
  });

  test.each([
    ['linkedActivePersonCount', { linkedActivePersonCount: 1 }],
    ['yearRowCount', { yearRowCount: 1 }],
    ['awardCount', { awardCount: 2 }],
    ['billCount', { billCount: 1 }],
    ['watchCount', { watchCount: 1 }],
    ['capabilityCount', { capabilityCount: 1 }],
    ['procurementLineCount', { procurementLineCount: 1 }],
    ['jbookCitationCount', { jbookCitationCount: 1 }],
    ['projectCount', { projectCount: 1 }],
  ])('KEEPS a real-but-uncovered PE when %s > 0', (_label, override) => {
    const d = classifyPeRetire({ ...noSignals, ...(override as Partial<PeRetireSignals>) });
    expect(d.action).toBe('keep');
    expect(d.reason).toBe('has_live_signal');
  });

  test('hasLiveSignal is false only when every signal is zero', () => {
    expect(hasLiveSignal(noSignals)).toBe(false);
    expect(hasLiveSignal({ ...noSignals, awardCount: 1 })).toBe(true);
  });
});

describe('decideLinkRepair', () => {
  // authoritative set: 0601A exists & live; 0602RETIRED is retired/gone.
  const isAuthoritativePe = (code: string) => code === '0601A' || code === '0603GOOD';

  test('keeps a primary link to an authoritative PE', () => {
    const d = decideLinkRepair({
      pePrimary: '0601A',
      peSecondary: [],
      isAuthoritativePe,
      pePrimaryTrusted: false,
    });
    expect(d.clearPrimary).toBe(false);
    expect(d.changed).toBe(false);
  });

  test('clears an untrusted primary link to a non-authoritative (retired/gone) PE', () => {
    const d = decideLinkRepair({
      pePrimary: '0602RETIRED',
      peSecondary: [],
      isAuthoritativePe,
      pePrimaryTrusted: false,
    });
    expect(d.clearPrimary).toBe(true);
    expect(d.changed).toBe(true);
    expect(d.reason).toBe('cleared_unauthoritative_untrusted_primary');
  });

  test('KEEPS a human-trusted primary even if the target is not authoritative', () => {
    const d = decideLinkRepair({
      pePrimary: '0602RETIRED',
      peSecondary: [],
      isAuthoritativePe,
      pePrimaryTrusted: true,
    });
    expect(d.clearPrimary).toBe(false);
    expect(d.reason).toBe('kept_trusted_primary_despite_unauthoritative_target');
  });

  test('strips non-authoritative secondary codes (secondary is never human-confirmed)', () => {
    const d = decideLinkRepair({
      pePrimary: '0601A',
      peSecondary: ['0603GOOD', '0602RETIRED', 'GONE'],
      isAuthoritativePe,
      pePrimaryTrusted: false,
    });
    expect(d.newPeSecondary).toEqual(['0603GOOD']);
    expect(d.changed).toBe(true);
    expect(d.reason).toBe('stripped_unauthoritative_secondary');
  });

  test('reports both edits when primary cleared and secondary stripped', () => {
    const d = decideLinkRepair({
      pePrimary: 'GONE',
      peSecondary: ['0602RETIRED'],
      isAuthoritativePe,
      pePrimaryTrusted: false,
    });
    expect(d.clearPrimary).toBe(true);
    expect(d.newPeSecondary).toEqual([]);
    expect(d.reason).toBe('cleared_primary_and_stripped_secondary');
  });

  test('no change when primary is null and all secondary are authoritative', () => {
    const d = decideLinkRepair({
      pePrimary: null,
      peSecondary: ['0601A'],
      isAuthoritativePe,
      pePrimaryTrusted: false,
    });
    expect(d.changed).toBe(false);
  });
});
