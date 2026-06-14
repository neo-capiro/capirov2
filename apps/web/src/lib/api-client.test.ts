import { describe, expect, test } from 'vitest';
import { isGenerationUrl } from './api-client.js';

describe('isGenerationUrl', () => {
  test('matches AI content-generation endpoints (get the long timeout)', () => {
    const generationUrls = [
      '/api/workflows/instances/abc/generate-document',
      '/api/workflows/instances/abc/generate-section',
      '/api/engagement/outreach/generate-batch',
      '/api/intelligence/actions/generate',
      '/api/workflows/instances/abc/ai-fill',
      '/api/workflows/instances/abc/ai-enhance-field',
      '/api/intelligence/actions/xyz/artifacts',
      '/api/engagement/attachments/abc/extract-text',
      '/api/clio/research/abc/clarify',
      '/api/chat/draft-whitepaper-section',
    ];
    for (const url of generationUrls) {
      expect(isGenerationUrl(url), url).toBe(true);
    }
  });

  test('does not match ordinary fast endpoints (keep the tight default)', () => {
    const ordinaryUrls = [
      '/api/clients',
      '/api/workflows/instances',
      '/api/workflows/instances/abc',
      '/api/strategies',
      '/api/workflows/instances/abc/context-candidates',
      '/api/engagement/outreach/audiences',
      '/api/intelligence/changes',
      undefined,
    ];
    for (const url of ordinaryUrls) {
      expect(isGenerationUrl(url), String(url)).toBe(false);
    }
  });
});
