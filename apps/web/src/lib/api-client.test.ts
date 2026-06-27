import { describe, expect, test } from 'vitest';
import { isGenerationUrl } from './api-client.js';

describe('isGenerationUrl', () => {
  test('matches AI content-generation endpoints (get the long timeout)', () => {
    const generationUrls = [
      '/api/engagement/outreach/generate-batch',
      '/api/intelligence/actions/generate',
      '/api/intelligence/actions/xyz/artifacts',
      '/api/engagement/attachments/abc/extract-text',
      '/api/clio/research/abc/clarify',
    ];
    for (const url of generationUrls) {
      expect(isGenerationUrl(url), url).toBe(true);
    }
  });

  test('does not match ordinary fast endpoints (keep the tight default)', () => {
    const ordinaryUrls = [
      '/api/clients',
      '/api/engagement/outreach/audiences',
      '/api/intelligence/changes',
      undefined,
    ];
    for (const url of ordinaryUrls) {
      expect(isGenerationUrl(url), String(url)).toBe(false);
    }
  });
});
