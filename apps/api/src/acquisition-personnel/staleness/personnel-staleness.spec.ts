import { describe, expect, test } from '@jest/globals';
import { classifyPersonStaleness, isTier1 } from './personnel-staleness.js';

const src = (...sources: string[]) => sources.map((source) => ({ source }));

describe('classifyPersonStaleness', () => {
  test('skips a person already superseded', () => {
    const d = classifyPersonStaleness({
      supersededAt: new Date('2026-06-05T00:00:00Z'),
      sources: src('stanford_dow_directory_jan2026'),
    });
    expect(d.action).toBe('skip');
    expect(d.reason).toBe('already_superseded');
  });

  test('skips a person with no source mentions (nothing to judge)', () => {
    const d = classifyPersonStaleness({ supersededAt: null, sources: [] });
    expect(d.action).toBe('skip');
    expect(d.reason).toBe('no_source_mentions');
  });

  test('supersedes a person whose only source is the old DoW directory', () => {
    const d = classifyPersonStaleness({
      supersededAt: null,
      sources: src('stanford_dow_directory_jan2026'),
    });
    expect(d.action).toBe('supersede');
  });

  test('supersedes a tier-1-only person absent from the new directory', () => {
    const d = classifyPersonStaleness({ supersededAt: null, sources: src('stanford_dow_tier1') });
    expect(d.action).toBe('supersede');
  });

  test('supersedes when every source is in the deprecated DoW set (directory + tier1)', () => {
    const d = classifyPersonStaleness({
      supersededAt: null,
      sources: src('stanford_dow_directory_jan2026', 'stanford_dow_tier1'),
    });
    expect(d.action).toBe('supersede');
  });

  test('KEEPS a person re-asserted by the current directory', () => {
    const d = classifyPersonStaleness({
      supersededAt: null,
      sources: src('stanford_dow_directory_jan2026', 'dow_directory_rev6_2026_06'),
    });
    expect(d.action).toBe('keep');
    expect(d.reason).toBe('has_current_or_other_source');
  });

  test('KEEPS a congressional-staff person (population not re-covered by the new directory)', () => {
    const d = classifyPersonStaleness({
      supersededAt: null,
      sources: src('stanford_dow_congressional_staff_jan2026'),
    });
    expect(d.action).toBe('keep');
  });

  test('KEEPS a person also vouched for by another live ingest (press/SAM/etc.)', () => {
    const d = classifyPersonStaleness({
      supersededAt: null,
      sources: src('stanford_dow_directory_jan2026', 'dod_press_release'),
    });
    expect(d.action).toBe('keep');
  });

  test('KEEPS a person whose link was human-confirmed (pe_match_confirmed source)', () => {
    const d = classifyPersonStaleness({
      supersededAt: null,
      sources: src('stanford_dow_directory_jan2026', 'pe_match_confirmed'),
    });
    expect(d.action).toBe('keep');
  });

  test('isTier1 detects a tier-1 mention', () => {
    expect(isTier1(src('stanford_dow_tier1', 'stanford_dow_directory_jan2026'))).toBe(true);
    expect(isTier1(src('stanford_dow_directory_jan2026'))).toBe(false);
  });
});
