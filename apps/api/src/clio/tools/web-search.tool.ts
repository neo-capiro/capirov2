import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/config.schema.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Web search tool. Two providers in priority order:
 *
 *   1. Tavily (https://tavily.com) — best AI-tuned search results, returns
 *      titles + snippets + URLs in one call. Requires TAVILY_API_KEY.
 *   2. DuckDuckGo Instant Answer API — free, no key needed, but only
 *      returns abstracts for entity-style queries and a small "related
 *      topics" list. Fallback so the tool works at all without provisioning.
 *
 * The Bedrock model sees the same tool surface regardless of which
 * backend ran — it just gets a list of {title, url, snippet} results.
 */
@Injectable()
export class WebSearchTool implements Tool {
  private readonly logger = new Logger(WebSearchTool.name);
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'web_search',
    description:
      'Search the public web for current information. Use this when the user asks about recent events, current state of the world, or anything outside your training data cutoff. Returns up to 5 results with titles, URLs, and snippets.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description:
            'The search query. Phrase as you would a Google query — keywords, not full sentences. Examples: "House appropriations subcommittee FY2026 markup schedule", "OpenAI o1 model release date".',
        },
      },
    },
  };

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async execute(rawInput: Record<string, unknown>, _ctx: ToolExecutionContext) {
    const query = typeof rawInput.query === 'string' ? rawInput.query.trim() : '';
    if (!query) {
      return { ok: false, error: 'query is required', results: [] };
    }
    const tavilyKey = this.config.get('TAVILY_API_KEY', { infer: true });
    if (tavilyKey) {
      try {
        const results = await this.tavily(query, tavilyKey);
        return { ok: true, provider: 'tavily', results };
      } catch (err) {
        this.logger.warn(`tavily search failed, falling back to ddg: ${String(err)}`);
      }
    }
    try {
      const results = await this.ddg(query);
      return { ok: true, provider: 'duckduckgo', results };
    } catch (err) {
      this.logger.warn(`ddg search failed: ${String(err)}`);
      throw new ServiceUnavailableException('Web search is currently unavailable');
    }
  }

  private async tavily(query: string, apiKey: string): Promise<SearchResult[]> {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
      }),
      // Tavily is usually sub-second; cap at 10s so a slow upstream
      // doesn't stretch the agent loop's per-turn budget.
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`tavily ${response.status}`);
    }
    const data = (await response.json()) as { results?: Array<Record<string, unknown>> };
    return (data.results ?? []).slice(0, 5).map((r) => ({
      title: stringField(r.title, ''),
      url: stringField(r.url, ''),
      snippet: stringField(r.content, '').slice(0, 600),
    }));
  }

  private async ddg(query: string): Promise<SearchResult[]> {
    // DuckDuckGo's Instant Answer API. Free, no key. Only returns
    // entity-style abstracts + a few "related topics" — not a real
    // search index. Good enough as a baseline so the tool always
    // returns *something*; configure TAVILY_API_KEY for proper search.
    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '1');
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`ddg ${response.status}`);
    }
    const data = (await response.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
    };
    const out: SearchResult[] = [];
    if (data.AbstractText) {
      out.push({
        title: data.Heading ?? query,
        url: data.AbstractURL ?? '',
        snippet: data.AbstractText,
      });
    }
    for (const t of data.RelatedTopics ?? []) {
      if (!t.Text || !t.FirstURL) continue;
      out.push({
        title: t.Text.split(' - ')[0] ?? t.Text,
        url: t.FirstURL,
        snippet: t.Text,
      });
      if (out.length >= 5) break;
    }
    return out;
  }
}

function stringField(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}
