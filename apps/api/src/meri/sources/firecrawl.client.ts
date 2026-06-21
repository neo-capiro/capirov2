import { fetchJson } from './http.js';
import { requireApiKey } from './utils.js';

const FIRECRAWL_DEFAULT_ROOT = 'https://api.firecrawl.dev/v1/';

export interface FirecrawlDocument {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  metadata?: Record<string, unknown>;
}

interface FirecrawlEnvelope {
  success?: boolean;
  data?: FirecrawlDocument;
  error?: string;
}

interface FirecrawlMapEnvelope {
  success?: boolean;
  links?: string[];
  error?: string;
}

interface FirecrawlCrawlStartEnvelope {
  success?: boolean;
  id?: string;
  url?: string;
  error?: string;
}

interface FirecrawlCrawlStatusEnvelope {
  success?: boolean;
  status?: 'scraping' | 'completed' | 'failed' | string;
  data?: Array<{ markdown?: string; metadata?: Record<string, unknown> }>;
  error?: string;
}

export interface FirecrawlCrawlPage {
  url: string;
  markdown: string;
}

export interface FirecrawlCrawlOptions {
  limit?: number;
  maxDepth?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  scrapeOptions?: FirecrawlScrapeOptions;
}

export interface FirecrawlScrapeOptions {
  formats?: Array<'markdown' | 'html' | 'rawHtml'>;
  onlyMainContent?: boolean;
  timeoutMs?: number;
  waitFor?: number;
}

export interface FirecrawlMapOptions {
  search?: string;
  limit?: number;
  timeoutMs?: number;
}

export class FirecrawlClient {
  private readonly apiKey: string;
  private readonly apiRoot: string;

  constructor(apiKey: string, apiRoot = FIRECRAWL_DEFAULT_ROOT) {
    this.apiKey = requireApiKey(apiKey, 'FIRECRAWL_API_KEY');
    this.apiRoot = apiRoot.endsWith('/') ? apiRoot : `${apiRoot}/`;
  }

  async scrape(url: string, options: FirecrawlScrapeOptions = {}): Promise<FirecrawlDocument> {
    const endpoint = new URL('scrape', this.apiRoot);
    const payload = {
      url,
      formats: options.formats ?? ['markdown'],
      onlyMainContent: options.onlyMainContent ?? true,
      ...(typeof options.waitFor === 'number' ? { waitFor: options.waitFor } : {}),
    };

    const response = await fetchJson<FirecrawlEnvelope>(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      timeoutMs: options.timeoutMs,
      secrets: [this.apiKey],
    });

    if (!response.success || !response.data) {
      throw new Error(response.error ?? `Firecrawl scrape failed for ${url}`);
    }

    return response.data;
  }

  async map(url: string, options: FirecrawlMapOptions = {}): Promise<string[]> {
    const endpoint = new URL('map', this.apiRoot);
    const payload = {
      url,
      ...(options.search ? { search: options.search } : {}),
      ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
    };

    const response = await fetchJson<FirecrawlMapEnvelope>(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      timeoutMs: options.timeoutMs,
      secrets: [this.apiKey],
    });

    if (!response.success) {
      throw new Error(response.error ?? `Firecrawl map failed for ${url}`);
    }

    return response.links ?? [];
  }

  async crawl(url: string, options: FirecrawlCrawlOptions = {}): Promise<FirecrawlCrawlPage[]> {
    const endpoint = new URL('crawl', this.apiRoot);
    const payload = {
      url,
      ...(typeof options.limit === 'number' ? { limit: options.limit } : {}),
      ...(typeof options.maxDepth === 'number' ? { maxDepth: options.maxDepth } : {}),
      scrapeOptions: {
        formats: options.scrapeOptions?.formats ?? ['markdown'],
        onlyMainContent: options.scrapeOptions?.onlyMainContent ?? true,
        ...(typeof options.scrapeOptions?.waitFor === 'number' ? { waitFor: options.scrapeOptions.waitFor } : {}),
      },
    };

    const started = await fetchJson<FirecrawlCrawlStartEnvelope>(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
      timeoutMs: options.timeoutMs,
      secrets: [this.apiKey],
    });

    if (!started.success || !started.url) {
      throw new Error(started.error ?? `Firecrawl crawl start failed for ${url}`);
    }

    const pollIntervalMs = options.pollIntervalMs ?? 2_500;
    const maxPolls = Math.max(20, Math.ceil((options.timeoutMs ?? 120_000) / Math.max(500, pollIntervalMs)));

    for (let i = 0; i < maxPolls; i += 1) {
      const status = await fetchJson<FirecrawlCrawlStatusEnvelope>(new URL(started.url), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeoutMs: options.timeoutMs,
        secrets: [this.apiKey],
      });

      if (status.status === 'completed') {
        const pages = (status.data ?? [])
          .map((row) => {
            const sourceURL = String(row.metadata?.sourceURL ?? row.metadata?.url ?? '').trim();
            const markdown = String(row.markdown ?? '').trim();
            if (!sourceURL || !markdown) return null;
            return { url: sourceURL, markdown } as FirecrawlCrawlPage;
          })
          .filter((row): row is FirecrawlCrawlPage => !!row);
        return pages;
      }

      if (status.status === 'failed') {
        throw new Error(status.error ?? `Firecrawl crawl failed for ${url}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Firecrawl crawl timed out for ${url}`);
  }
}
