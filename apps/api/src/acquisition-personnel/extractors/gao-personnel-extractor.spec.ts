import { describe, expect, test } from '@jest/globals';
import {
  GaoPersonnelExtractorService,
  GAO_INTERVIEWEE_CONFIDENCE,
  type GaoReportInput,
  type GaoLlmPerson,
} from './gao-personnel-extractor.service.js';

const svc = new GaoPersonnelExtractorService();

function report(over: Partial<GaoReportInput> = {}): GaoReportInput {
  return {
    id: 'GAO-26-106155',
    title: 'Weapon Systems Annual Assessment',
    summary: 'GAO reviewed major DoD acquisition programs.',
    url: 'https://www.gao.gov/products/gao-26-106155',
    publishDate: new Date('2026-04-01T00:00:00Z'),
    topics: ['Defense Acquisition'],
    agencies: ['Department of Defense'],
    ...over,
  };
}

describe('GaoPersonnelExtractorService.extractFromReport', () => {
  test('GAO report → Claude (stub) extracts persons', async () => {
    const extract = async (): Promise<GaoLlmPerson[]> => [
      { full_name: 'Dr. Jane Smith', title: 'Program Manager', organization: 'PEO Aviation', quote: 'Dr. Smith told GAO...' },
    ];
    const out = await svc.extractFromReport(report(), extract);
    expect(out).toHaveLength(1);
    expect(out[0]?.fullName).toBe('Dr. Jane Smith');
    expect(out[0]?.title).toBe('Program Manager');
    expect(out[0]?.organization).toBe('PEO Aviation');
    expect(out[0]?.confidence).toBe(GAO_INTERVIEWEE_CONFIDENCE);
    expect(out[0]?.snippet).toBe('Dr. Smith told GAO...');
    expect(out[0]?.observedAt).toEqual(report().publishDate);
    expect(out[0]?.sourceUrl).toBe(report().url);
  });

  test('report yielding no persons → empty', async () => {
    const extract = async (): Promise<GaoLlmPerson[]> => [];
    const out = await svc.extractFromReport(report(), extract);
    expect(out).toHaveLength(0);
  });

  test('invalid mentions dropped: missing last name, empty title', async () => {
    const extract = async (): Promise<GaoLlmPerson[]> => [
      { full_name: 'Smith', title: 'Director' }, // no first name
      { full_name: 'John Doe', title: '' }, // empty title
      { full_name: 'Jane Roe', title: 'Director', organization: 'Navy' }, // valid
    ];
    const out = await svc.extractFromReport(report(), extract);
    expect(out.map((p) => p.fullName)).toEqual(['Jane Roe']);
  });

  test('snippet falls back to title/org/report when no quote', async () => {
    const extract = async (): Promise<GaoLlmPerson[]> => [
      { full_name: 'Jane Roe', title: 'Director', organization: 'Navy' },
    ];
    const out = await svc.extractFromReport(report(), extract);
    expect(out[0]?.snippet).toBe('Director, Navy — Weapon Systems Annual Assessment');
  });

  test('de-dups same person named twice', async () => {
    const extract = async (): Promise<GaoLlmPerson[]> => [
      { full_name: 'Jane Roe', title: 'Director' },
      { full_name: 'Jane Roe', title: 'Director' },
    ];
    const out = await svc.extractFromReport(report(), extract);
    expect(out).toHaveLength(1);
  });

  test('LLM failure → empty (never throws into runner)', async () => {
    const extract = async (): Promise<GaoLlmPerson[]> => {
      throw new Error('LLM down');
    };
    const out = await svc.extractFromReport(report(), extract);
    expect(out).toHaveLength(0);
  });

  test('idempotency: observedAt mirrors publishDate (writer dedup key)', async () => {
    const extract = async (): Promise<GaoLlmPerson[]> => [{ full_name: 'Jane Roe', title: 'Director' }];
    const r = report();
    const out = await svc.extractFromReport(r, extract);
    expect(out[0]?.observedAt).toEqual(r.publishDate);
  });
});

describe('buildUserPrompt', () => {
  test('includes schema + report metadata when no full text', () => {
    const p = GaoPersonnelExtractorService.buildUserPrompt(report());
    expect(p).toMatch(/persons/);
    expect(p).toMatch(/GAO-26-106155/);
    expect(p).toMatch(/Weapon Systems Annual Assessment/);
    expect(p).toMatch(/Agencies: Department of Defense/);
  });
  test('prefers full text when supplied (future Textract seam)', () => {
    const p = GaoPersonnelExtractorService.buildUserPrompt(report({ fullText: 'FULL REPORT BODY HERE' }));
    expect(p).toMatch(/FULL REPORT BODY HERE/);
  });
});
