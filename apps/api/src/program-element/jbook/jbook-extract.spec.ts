import { describe, expect, test } from '@jest/globals';
import {
  serviceFromPeCode,
  readR1UrlFromText,
  jbookDeepLink,
  citationKey,
  isValidPeCode,
} from './jbook-extract.js';

// Pins the pure logic that determines J-book data correctness + page-level
// provenance (the citable source users open + screenshot).

describe('serviceFromPeCode', () => {
  test('maps service designator letters', () => {
    expect(serviceFromPeCode('0601102A')).toEqual({ service: 'ARMY', serviceCode: 'A' });
    expect(serviceFromPeCode('0603506N')).toEqual({ service: 'NAVY', serviceCode: 'N' });
    expect(serviceFromPeCode('0602201F')).toEqual({ service: 'AF', serviceCode: 'F' });
    expect(serviceFromPeCode('0305282M')).toEqual({ service: 'USMC', serviceCode: 'M' });
    expect(serviceFromPeCode('0602303E')).toEqual({ service: 'DARPA', serviceCode: 'E' });
    expect(serviceFromPeCode('0603860D')).toEqual({ service: 'DW', serviceCode: 'D' });
  });

  test('unknown designator yields null service but keeps code', () => {
    expect(serviceFromPeCode('0601000Z')).toEqual({ service: null, serviceCode: 'Z' });
  });
});

describe('readR1UrlFromText', () => {
  test('extracts the r1 url from top_level_summaries', () => {
    const yaml = [
      'fy: 2027',
      'top_level_summaries:',
      '  r1:',
      '    url: https://comptroller.war.gov/x/FY2027_r1.pdf',
      '    role: rdte_master_list',
      '  p1:',
      '    url: https://comptroller.war.gov/x/FY2027_p1.pdf',
    ].join('\n');
    expect(readR1UrlFromText(yaml)).toBe('https://comptroller.war.gov/x/FY2027_r1.pdf');
  });

  test('does not pick up p1 url when p1 precedes r1', () => {
    const yaml = [
      'top_level_summaries:',
      '  p1:',
      '    url: https://x/p1.pdf',
      '  r1:',
      '    url: https://x/r1.pdf',
    ].join('\n');
    expect(readR1UrlFromText(yaml)).toBe('https://x/r1.pdf');
  });

  test('throws when r1 url missing', () => {
    expect(() => readR1UrlFromText('top_level_summaries:\n  p1:\n    url: https://x/p1.pdf')).toThrow();
  });
});

describe('jbookDeepLink', () => {
  test('builds a page-anchored citation', () => {
    expect(jbookDeepLink('https://comptroller.war.gov/x/FY2027_r1.pdf', 10)).toBe(
      'https://comptroller.war.gov/x/FY2027_r1.pdf#page=10',
    );
  });
});

describe('citationKey dedup', () => {
  test('same PE same page dedups; different pages distinct', () => {
    const rows = [
      { pe: '0601102A', page: 10 },
      { pe: '0601102A', page: 10 },
      { pe: '0601102A', page: 42 },
      { pe: '0603506N', page: 10 },
    ];
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const r of rows) {
      const k = citationKey(r.pe, 'R', r.page);
      if (!seen.has(k)) {
        seen.add(k);
        kept.push(k);
      }
    }
    expect(kept).toEqual(['0601102A|R|10', '0601102A|R|42', '0603506N|R|10']);
  });
});

describe('isValidPeCode', () => {
  test('accepts canonical 8-char Service codes', () => {
    for (const code of ['0601102A', '0603506N', '0602201F', '0305282M', '0602303E', '0603860D']) {
      expect(isValidPeCode(code)).toBe(true);
    }
  });

  test('accepts Defense-Wide / Space Force codes with sub-element suffixes', () => {
    // These were previously quarantined by the 8-char-only regex.
    for (const code of ['0604122D8Z', '0505167D8Z', '0604011D8Z', '0208085JCY', '1203622SF', '1203154SF', '1206616SF']) {
      expect(isValidPeCode(code)).toBe(true);
    }
  });

  test('trims and upper-cases before validating', () => {
    expect(isValidPeCode('  0604122d8z ')).toBe(true);
    expect(isValidPeCode('0603270a')).toBe(true);
  });

  test('rejects pure-numeric and malformed codes', () => {
    for (const bad of ['9999999999', '1234567', '123A', '060270A', 'ABCDEFGH', '', '   ']) {
      expect(isValidPeCode(bad)).toBe(false);
    }
  });

  test('rejects null/undefined safely', () => {
    expect(isValidPeCode(null)).toBe(false);
    expect(isValidPeCode(undefined)).toBe(false);
  });
});
