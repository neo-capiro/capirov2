import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { InsightsService } from './insights.service.js';

const SAMPLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0">
  <channel>
    <title>The Cycle</title>
    <item>
      <title>Reading the Markup</title>
      <link>https://capirohq.substack.com/p/reading-the-markup</link>
      <pubDate>Tue, 17 Jun 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[<p>An <strong>excerpt</strong> about committee markups &amp; floor strategy.</p><img src="https://img.substack.com/thumb1.jpg" />]]></description>
      <enclosure url="https://img.substack.com/enclosure1.jpg" type="image/jpeg"/>
    </item>
    <item>
      <title>Whip Counts</title>
      <link>https://capirohq.substack.com/p/whip-counts</link>
      <pubDate>Mon, 16 Jun 2026 09:00:00 GMT</pubDate>
      <description>Plain text excerpt no image.</description>
    </item>
  </channel>
</rss>`;

function mockFetchOnce(body: string, ok = true, status = 200) {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    ok,
    status,
    text: async () => body,
  })) as unknown as typeof fetch;
}

describe('InsightsService', () => {
  let origFetch: typeof fetch;
  beforeEach(() => {
    origFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = origFetch;
    jest.restoreAllMocks();
  });

  it('parses the Substack feed into the documented JSON shape', async () => {
    mockFetchOnce(SAMPLE_FEED);
    const svc = new InsightsService();
    const { items } = await svc.getInsights();
    expect(items).toHaveLength(2);
    const first = items[0]!;
    expect(first.title).toBe('Reading the Markup');
    expect(first.link).toBe('https://capirohq.substack.com/p/reading-the-markup');
    expect(first.pubDate).toBe('2026-06-17T10:00:00.000Z'); // normalized to ISO
    expect(first.description).toContain('committee markups'); // tags stripped
    expect(first.description).not.toContain('<strong>');
    expect(first.thumbnail).toBe('https://img.substack.com/enclosure1.jpg'); // enclosure preferred
  });

  it('falls back to the first <img> when no enclosure/media exists', async () => {
    const feed = SAMPLE_FEED.replace(/<enclosure[^>]*\/>/, '');
    mockFetchOnce(feed);
    const svc = new InsightsService();
    const { items } = await svc.getInsights();
    expect(items[0]!.thumbnail).toBe('https://img.substack.com/thumb1.jpg');
    expect(items[1]!.thumbnail).toBeNull(); // no image at all
  });

  it('caches results and does not re-fetch within the TTL', async () => {
    mockFetchOnce(SAMPLE_FEED);
    const svc = new InsightsService();
    await svc.getInsights();
    await svc.getInsights();
    expect((global.fetch as unknown as jest.Mock).mock.calls.length).toBe(1);
  });

  it('returns empty items (not a throw) when the feed fails and no cache exists', async () => {
    mockFetchOnce('', false, 403);
    const svc = new InsightsService();
    const { items } = await svc.getInsights();
    expect(items).toEqual([]);
  });

  it('serves stale cache when a later refresh fails', async () => {
    mockFetchOnce(SAMPLE_FEED);
    const svc = new InsightsService();
    await svc.getInsights(); // populates cache
    // force TTL expiry then fail
    (svc as unknown as { cache: { at: number } }).cache.at = 0;
    mockFetchOnce('', false, 500);
    const { items } = await svc.getInsights();
    expect(items).toHaveLength(2); // stale served, not empty
  });
});
