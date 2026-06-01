import { describe, expect, test } from '@jest/globals';
import {
  PressReleasePersonnelExtractorService,
  hasFirstAndLast,
  type PressArticle,
  type LlmMention,
} from './press-release-personnel-extractor.service.js';

const svc = new PressReleasePersonnelExtractorService();
const knownPes = new Set(['0604201A', '0603270A']);

function article(over: Partial<PressArticle> = {}): PressArticle {
  return {
    title: 'PEO Aviation announces milestone',
    summary: 'Body text',
    url: 'https://www.defense.gov/News/Releases/Release/Article/1',
    publishedAt: new Date('2026-05-30T00:00:00Z'),
    ...over,
  };
}

describe('hasFirstAndLast', () => {
  test('strips honorifics, requires first+last', () => {
    expect(hasFirstAndLast('Dr. Jane Smith')).toBe(true);
    expect(hasFirstAndLast('Jane Smith')).toBe(true);
    expect(hasFirstAndLast('Smith')).toBe(false);
    expect(hasFirstAndLast('Dr. Smith')).toBe(false);
  });
});

describe('PressReleasePersonnelExtractorService.extractFromArticle', () => {
  test('article naming "Dr. Jane Smith, PEO Aviation" → person extracted', async () => {
    const extract = async (): Promise<LlmMention[]> => [
      { full_name: 'Dr. Jane Smith', title: 'Program Executive Officer', organization: 'PEO Aviation', programs_mentioned: [], role_inferred: 'PEO' },
    ];
    const out = await svc.extractFromArticle(article(), extract, knownPes);
    expect(out).toHaveLength(1);
    expect(out[0]?.fullName).toBe('Dr. Jane Smith');
    expect(out[0]?.title).toBe('Program Executive Officer');
    expect(out[0]?.organization).toBe('PEO Aviation');
    expect(out[0]?.confidence).toBe(0.65);
    expect(out[0]?.sourceUrl).toBe(article().url);
  });

  test('article with no DoD names → empty mentions → no rows', async () => {
    const extract = async (): Promise<LlmMention[]> => [];
    const out = await svc.extractFromArticle(article(), extract, knownPes);
    expect(out).toHaveLength(0);
  });

  test('invalid mentions dropped: missing last name, empty title', async () => {
    const extract = async (): Promise<LlmMention[]> => [
      { full_name: 'Smith', title: 'PM' }, // no first name
      { full_name: 'John Doe', title: '' }, // empty title
      { full_name: 'Jane Roe', title: 'Director' }, // valid
    ];
    const out = await svc.extractFromArticle(article(), extract, knownPes);
    expect(out.map((p) => p.fullName)).toEqual(['Jane Roe']);
  });

  test('PE attribution: known PE in programs_mentioned → pePrimary set; unknown ignored', async () => {
    const extract = async (): Promise<LlmMention[]> => [
      { full_name: 'Jane Smith', title: 'PM', programs_mentioned: ['Effort under 0604201A', 'bogus 0609999Z'] },
    ];
    const out = await svc.extractFromArticle(article(), extract, knownPes);
    expect(out[0]?.pePrimary).toBe('0604201A');
    expect(out[0]?.peSecondary).toEqual([]);
  });

  test('LLM failure → empty (never throws into runner)', async () => {
    const extract = async (): Promise<LlmMention[]> => { throw new Error('LLM down'); };
    const out = await svc.extractFromArticle(article(), extract, knownPes);
    expect(out).toHaveLength(0);
  });

  test('deterministic: observedAt mirrors publishedAt (idempotency key for writer)', async () => {
    const extract = async (): Promise<LlmMention[]> => [{ full_name: 'Jane Smith', title: 'PM' }];
    const a = article();
    const out = await svc.extractFromArticle(a, extract, knownPes);
    expect(out[0]?.observedAt).toEqual(a.publishedAt);
  });
});

describe('buildUserPrompt', () => {
  test('includes schema + article title/summary', () => {
    const p = PressReleasePersonnelExtractorService.buildUserPrompt(article());
    expect(p).toMatch(/mentions/);
    expect(p).toMatch(/PEO Aviation announces milestone/);
  });
});
