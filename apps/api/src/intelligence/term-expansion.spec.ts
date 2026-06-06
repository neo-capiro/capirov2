import {
  ACRONYM_EXPANSIONS,
  expandTerms,
  isKnownAcronym,
  MIN_KEYWORD_TOKEN_LENGTH,
} from './term-expansion.js';

describe('term-expansion', () => {
  test('expands a known acronym to its phrase, keeping the original', () => {
    expect(expandTerms(['EW'])).toEqual(['EW', 'electronic warfare']);
  });

  test('passes through unknown / long terms unchanged', () => {
    expect(expandTerms(['hypersonics'])).toEqual(['hypersonics']);
  });

  test('de-dupes case-insensitively and preserves order', () => {
    // 'AI' adds its expansion; the lowercase dup and explicit phrase collapse away.
    expect(expandTerms(['AI', 'ai', 'Artificial Intelligence'])).toEqual([
      'AI',
      'artificial intelligence',
    ]);
  });

  test('isKnownAcronym is case-insensitive and trims', () => {
    expect(isKnownAcronym(' c2 ')).toBe(true);
    expect(isKnownAcronym('C2')).toBe(true);
    expect(isKnownAcronym('hypersonics')).toBe(false);
  });

  test('ignores empty / whitespace entries', () => {
    expect(expandTerms(['', '  ', 'EW'])).toEqual(['EW', 'electronic warfare']);
  });

  test('expansions are lowercase and longer than the acronym (sanity)', () => {
    for (const [acronym, phrase] of Object.entries(ACRONYM_EXPANSIONS)) {
      expect(phrase).toBe(phrase.toLowerCase());
      expect(phrase.length).toBeGreaterThan(acronym.length);
    }
  });

  test('MIN_KEYWORD_TOKEN_LENGTH keeps short acronyms out of the raw keyword path', () => {
    expect(MIN_KEYWORD_TOKEN_LENGTH).toBe(4);
  });
});
