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

export interface FirecrawlScrapeOptions {
  formats?: Array<'markdown' | 'html' | 'rawHtml'>;
  onlyMainContent?: boolean;
  timeoutMs?: number;
  waitFor?: number;
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
}
