import { describe, expect, test } from '@jest/globals';
import {
  serviceFromPeCode,
  readR1UrlFromText,
  jbookDeepLink,
  citationKey,
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
