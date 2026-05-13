import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/config.schema.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

/**
 * Firecrawl (https://firecrawl.dev) — agent-first web scraping/search.
 *
 * Two operations exposed as one tool with a `mode` field:
 *
 *   - mode='scrape': fetch a single URL, return clean markdown of the
 *     page. Equivalent to fetch_url but produces vastly better results
 *     because Firecrawl runs a real headless browser, drops ads/cookie
 *     banners/nav chrome, and returns structured markdown the model can
 *     ground on.
 *   - mode='search': Google-style query → ranked list of results, with
 *     `scrapeOptions.formats: ['markdown']` so each result already carries
 *     its scraped markdown content. One round-trip replaces a
 *     web_search + N fetch_url calls.
 *
 * Failure modes:
 *   - No FIRECRAWL_API_KEY: returns ok:false, configured:false so the
 *     agent can tell the user the connector isn't wired up.
 *   - Upstream 4xx/5xx: returns ok:false with the upstream status. Never
 *     throws — the agent loop treats tool failures as "report back to
 *     user", not "abort turn".
 */
@Injectable()
export class FirecrawlTool implements Tool {
  private readonly logger = new Logger(FirecrawlTool.name);
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'firecrawl',
    description:
      'Premium web scraping and search via Firecrawl. ' +
      'mode="scrape" fetches a single URL and returns clean markdown — use this when you need the actual content of a page (better than fetch_url for JS-heavy sites, news articles, product pages). ' +
      'mode="search" runs a Google-style search and returns ranked results, each already scraped to markdown — use this when you need fresh information AND the page content in one call (replaces web_search + multiple fetch_url calls). ' +
      'When in doubt, prefer firecrawl over web_search + fetch_url because it uses fewer tokens and returns better-formatted results.',
    inputSchema: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: {
          type: 'string',
          enum: ['scrape', 'search'],
          description: 'scrape: single URL → markdown. search: query → top results with markdown.',
        },
        url: {
          type: 'string',
          description: 'Absolute http(s) URL. Required when mode=scrape.',
        },
        query: {
          type: 'string',
          description: 'Search query. Required when mode=search. Phrase as a Google query.',
        },
        limit: {
          type: 'integer',
          description: 'Max results when mode=search. Default 5, max 10.',
        },
      },
    },
  };

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async execute(rawInput: Record<string, unknown>, _ctx: ToolExecutionContext) {
    const key = this.config.get('FIRECRAWL_API_KEY', { infer: true });
    // Secrets Manager doesn't accept empty strings — we provision a
    // placeholder of "REPLACE_ME" on first deploy so the CDK import
    // resolves, then expect the operator to rotate it in.
    if (!key || key === 'REPLACE_ME') {
      return {
        ok: false,
        configured: false,
        error:
          'Firecrawl is not configured in this environment. Tell the user the connector is registered but the FIRECRAWL_API_KEY secret needs to be set — `aws secretsmanager put-secret-value --secret-id capiro/staging/firecrawl-api-key --secret-string <KEY>` then force-redeploy the API service.',
      };
    }
    const mode = typeof rawInput.mode === 'string' ? rawInput.mode : '';
    if (mode === 'scrape') return this.scrape(rawInput, key);
    if (mode === 'search') return this.search(rawInput, key);
    return { ok: false, error: 'mode must be "scrape" or "search"' };
  }

  private async scrape(input: Record<string, unknown>, key: string) {
    const url = typeof input.url === 'string' ? input.url.trim() : '';
    if (!url) return { ok: false, error: 'url is required when mode=scrape' };
    try {
      const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
        }),
        // Firecrawl scrape can take ~10s on heavy pages; cap at 30s.
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `firecrawl ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = (await res.json()) as {
        success?: boolean;
        data?: { markdown?: string; metadata?: { title?: string; description?: string } };
      };
      const markdown = data.data?.markdown ?? '';
      return {
        ok: true,
        url,
        title: data.data?.metadata?.title ?? '',
        description: data.data?.metadata?.description ?? '',
        // Cap markdown at 16KB so a giant article doesn't blow the
        // model's context. Model can ask to re-scrape with different
        // settings if it needs more.
        markdown: markdown.slice(0, 16_000),
        truncated: markdown.length > 16_000,
      };
    } catch (err) {
      this.logger.warn(`firecrawl scrape failed: ${String(err)}`);
      return { ok: false, error: `Firecrawl unreachable: ${String(err).slice(0, 200)}` };
    }
  }

  private async search(input: Record<string, unknown>, key: string) {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) return { ok: false, error: 'query is required when mode=search' };
    const limit = clamp(
      typeof input.limit === 'number' ? Math.floor(input.limit) : 5,
      1,
      10,
    );
    try {
      const res = await fetch('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query,
          limit,
          scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `firecrawl ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = (await res.json()) as {
        success?: boolean;
        data?: Array<{
          url?: string;
          title?: string;
          description?: string;
          markdown?: string;
        }>;
      };
      const results = (data.data ?? []).map((r) => ({
        url: r.url ?? '',
        title: r.title ?? '',
        description: r.description ?? '',
        // Trim per-result markdown harder than scrape — the model is
        // looking at N of these at once.
        markdown: (r.markdown ?? '').slice(0, 4_000),
      }));
      return { ok: true, query, results };
    } catch (err) {
      this.logger.warn(`firecrawl search failed: ${String(err)}`);
      return { ok: false, error: `Firecrawl unreachable: ${String(err).slice(0, 200)}` };
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
