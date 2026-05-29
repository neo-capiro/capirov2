import { describe, expect, test } from '@jest/globals';
import { normalizeName } from './name-normalizer.js';

describe('normalizeName', () => {
  const variants = [
    'BG Edward M. Barker',
    'Brigadier General Edward Barker, USA',
    'Mr. Edward Barker',
  ];

  test('same logical person across formats normalizes to same base key', () => {
    const keys = variants.map((v) => normalizeName(v).nameKey);
    const firstKey = keys[0] ?? '';
    expect(firstKey.startsWith('barker edward')).toBe(true);
    expect(keys[1]).toBe('barker edward');
    expect(keys[2]).toBe('barker edward');
  });

  test('diacritics normalize to same key', () => {
    expect(normalizeName('María García').nameKey).toBe(normalizeName('Maria Garcia').nameKey);
  });

  test('hyphenated names preserved', () => {
    expect(normalizeName('Smith-Jones, John A. Jr.').nameKey).toBe('smith-jones john a');
  });

  test('single-name edge case', () => {
    const out = normalizeName('Madonna');
    expect(out.nameKey).toBe('madonna madonna');
    expect(out.lastName).toBe('madonna');
  });

  test('all-caps + unicode handled', () => {
    expect(normalizeName('MAJ JOSÉ ÁLVAREZ').nameKey).toBe('alvarez jose');
    expect(normalizeName('MAJ JOSÉ ÁLVAREZ').rank).toBe('MAJ');
  });

  test.each([
    ['General John Doe', 'GEN'],
    ['Gen John Doe', 'GEN'],
    ['Lieutenant General John Doe', 'LTG'],
    ['Lt Gen John Doe', 'LTG'],
    ['Major General John Doe', 'MG'],
    ['Maj Gen John Doe', 'MG'],
    ['Brigadier General John Doe', 'BG'],
    ['Brig Gen John Doe', 'BG'],
    ['BG John Doe', 'BG'],
    ['Colonel John Doe', 'COL'],
    ['Col John Doe', 'COL'],
    ['Lieutenant Colonel John Doe', 'LTC'],
    ['Lt Col John Doe', 'LTC'],
    ['LTC John Doe', 'LTC'],
    ['Major John Doe', 'MAJ'],
    ['Maj John Doe', 'MAJ'],
    ['Captain John Doe', 'CPT'],
    ['Capt John Doe', 'CPT'],
    ['CPT John Doe', 'CPT'],
    ['Admiral John Doe', 'ADM'],
    ['Adm John Doe', 'ADM'],
    ['Vice Admiral John Doe', 'VADM'],
    ['VADM John Doe', 'VADM'],
    ['Rear Admiral John Doe', 'RADM'],
    ['RADM John Doe', 'RADM'],
    ['Commander John Doe', 'CDR'],
    ['CDR John Doe', 'CDR'],
    ['Lieutenant Commander John Doe', 'LCDR'],
    ['LCDR John Doe', 'LCDR'],
    ['Senior Executive Service Jane Doe', 'SES'],
    ['SES Jane Doe', 'SES'],
  ])('rank variant %s canonicalizes to %s', (input, rank) => {
    expect(normalizeName(input).rank).toBe(rank);
  });

  test.each([
    ['Hon. Jane Doe', 'HON'],
    ['Secretary Jane Doe', 'SEC'],
    ['Dr. Jane Doe', 'DR'],
    ['Mr. Jane Doe', 'MR'],
    ['Ms. Jane Doe', 'MS'],
  ])('honorific variant %s canonicalizes to %s', (input, honorific) => {
    expect(normalizeName(input).honorific).toBe(honorific);
  });

  test.each([
    ['John Doe Jr.', 'JR'],
    ['John Doe Sr', 'SR'],
    ['John Doe II', 'II'],
    ['John Doe III', 'III'],
    ['John Doe IV', 'IV'],
    ['John Doe V', 'V'],
  ])('suffix variant %s canonicalizes to %s', (input, suffix) => {
    expect(normalizeName(input).suffix).toBe(suffix);
  });
});
