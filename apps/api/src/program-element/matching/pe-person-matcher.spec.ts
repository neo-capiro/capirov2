import { describe, expect, test } from '@jest/globals';
import { distinctiveTokens, acronyms, scorePersonToPe, topPeCandidates } from './pe-person-matcher.js';

describe('distinctiveTokens', () => {
  test('drops stopwords and short tokens', () => {
    const t = distinctiveTokens('Program Executive Office for Abrams Tank Systems');
    expect(t.has('abrams')).toBe(true);
    expect(t.has('tank')).toBe(true);
    // stopworded generics
    expect(t.has('program')).toBe(false);
    expect(t.has('office')).toBe(false);
    expect(t.has('systems')).toBe(false);
  });
});

describe('acronyms', () => {
  test('extracts program acronyms, ignores generic ones', () => {
    const a = acronyms('AMPV Improvement Program, THAAD, and the US Army PM office');
    expect(a.has('ampv')).toBe(true);
    expect(a.has('thaad')).toBe(true);
    // stopworded acronym-like generics
    expect(a.has('us')).toBe(false);
    expect(a.has('pm')).toBe(false);
  });
});

describe('scorePersonToPe', () => {
  const pe = { peCode: '0203735A', text: 'Combat Vehicle Improvement Programs AMPV Improvement Program Abrams Tank Improve Prog Stryker Improvement' };

  test('shared program acronym + supporting term clears the review threshold', () => {
    const c = scorePersonToPe({ organization: 'Abrams Tank program', title: 'AMPV Deputy Product Manager' }, pe);
    expect(c).not.toBeNull();
    expect(c!.score).toBeGreaterThanOrEqual(0.5);
    expect(c!.breakdown.sharedAcronyms).toContain('ampv');
  });

  test('a single bare acronym with no supporting word does NOT match (precision guard)', () => {
    const c = scorePersonToPe({ organization: 'AMPV office', title: 'Analyst' }, pe);
    expect(c).toBeNull();
  });

  test('distinctive word overlap (Abrams + Stryker) contributes', () => {
    const c = scorePersonToPe({ organization: 'Abrams Tank and Stryker programs', title: 'Engineer' }, pe);
    expect(c).not.toBeNull();
    expect(c!.breakdown.sharedTokens).toContain('abrams');
  });

  test('no distinctive overlap -> null (no spurious match on generic words)', () => {
    const c = scorePersonToPe({ organization: 'Office of the General Counsel', title: 'Program Analyst' }, pe);
    expect(c).toBeNull();
  });

  test('generic-only org never matches', () => {
    const c = scorePersonToPe({ organization: 'US Army Program Executive Office', title: 'System Manager' }, pe);
    expect(c).toBeNull();
  });
});

describe('topPeCandidates', () => {
  const pes = [
    { peCode: '0203735A', text: 'AMPV Improvement Program Abrams Tank Stryker' },
    { peCode: '0605058A', text: 'Terminal High Altitude Area Defense THAAD' },
    { peCode: '0604129A', text: 'Advanced Power Applications' },
  ];

  test('returns best PE first, above threshold, capped', () => {
    const out = topPeCandidates({ organization: 'Terminal High Altitude Area Defense THAAD office', title: 'Lead Engineer' }, pes, 0.5, 5);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]!.peCode).toBe('0605058A');
    expect(out[0]!.breakdown.sharedAcronyms).toContain('thaad');
  });

  test('returns empty when nothing clears threshold', () => {
    const out = topPeCandidates({ organization: 'Senate Armed Services Committee', title: 'Staffer' }, pes, 0.5, 5);
    expect(out).toEqual([]);
  });
});
