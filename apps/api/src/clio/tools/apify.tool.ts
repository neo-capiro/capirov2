import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/config.schema.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

/**
 * Apify — pre-built scrapers for X, LinkedIn, Instagram, Google Maps,
 * Yelp, Crunchbase, etc. Each "actor" is a hosted scraper you invoke
 * with a JSON input payload and get back a dataset of results.
 *
 * Two-call pattern with one tool:
 *   - mode='list': returns a curated catalog of recommended actors so
 *     the model can choose without inventing actor IDs.
 *   - mode='run': calls /v2/acts/<actorId>/run-sync-get-dataset-items
 *     which blocks until the scrape finishes (or 60s, whichever first)
 *     and returns the dataset.
 *
 * The sync endpoint is the simplest UX — no polling, no run IDs to
 * track. Cost is fine for most quick scrapes (<60s). For long crawls
 * the model should warn the user and switch to async (future work).
 */
@Injectable()
export class ApifyTool implements Tool {
  private readonly logger = new Logger(ApifyTool.name);
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'apify',
    description:
      'Run pre-built scrapers (Apify actors) for sites that need real scraping: X/Twitter, LinkedIn, Instagram, TikTok, Google Maps, Yelp, Crunchbase, etc. ' +
      'mode="list" returns the curated catalog of recommended actors so you can pick one. ' +
      'mode="run" executes an actor with a JSON input and returns the dataset (up to 60s wait). ' +
      'Prefer this over firecrawl when the user wants social data, business listings, or anything that requires logged-in scraping. Per-run cost varies by actor; mention this to the user before running large jobs.',
    inputSchema: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: {
          type: 'string',
          enum: ['list', 'run'],
        },
        actorId: {
          type: 'string',
          description:
            'Apify actor id, e.g. "apify/instagram-scraper" or "apidojo/tweet-scraper". Required when mode=run. Use mode=list first if unsure.',
        },
        input: {
          type: 'object',
          description:
            'Actor input payload, shape depends on the actor. Check the catalog from mode=list for examples. Required when mode=run.',
        },
        maxItems: {
          type: 'integer',
          description: 'Cap on dataset items returned. Default 25, max 100.',
        },
      },
    },
  };

  // Curated catalog. Keeping this static + hand-picked so the model has
  // a reliable set of "this actor exists and takes these inputs"
  // suggestions rather than free-form guessing at actor names.
  private readonly catalog = [
    {
      actorId: 'apidojo/tweet-scraper',
      name: 'X (Twitter) tweet scraper',
      use: 'Search tweets by query or fetch a user\'s timeline.',
      exampleInput: { searchTerms: ['lobbying disclosure act'], maxItems: 25 },
    },
    {
      actorId: 'curious_coder/linkedin-profile-scraper',
      name: 'LinkedIn profile scraper',
      use: 'Pull profile data (headline, experience, education) by URL.',
      exampleInput: { profileUrls: ['https://www.linkedin.com/in/example'] },
    },
    {
      actorId: 'apify/instagram-scraper',
      name: 'Instagram scraper',
      use: 'Profile, hashtag, or post-URL scrape.',
      exampleInput: { directUrls: ['https://www.instagram.com/exampleuser/'], resultsLimit: 25 },
    },
    {
      actorId: 'compass/crawler-google-places',
      name: 'Google Maps / Places',
      use: 'Find businesses by search query + location, with reviews.',
      exampleInput: { searchStringsArray: ['lobbying firm'], locationQuery: 'Washington, DC', maxCrawledPlacesPerSearch: 20 },
    },
    {
      actorId: 'yin/yelp-scraper',
      name: 'Yelp scraper',
      use: 'Business listings + reviews from Yelp.',
      exampleInput: { searchTerms: ['lobbyist Washington DC'], maxItems: 20 },
    },
    {
      actorId: 'epctex/crunchbase-scraper',
      name: 'Crunchbase scraper',
      use: 'Company funding, investors, headcount.',
      exampleInput: { startUrls: ['https://www.crunchbase.com/organization/example'] },
    },
    {
      actorId: 'clockworks/free-tiktok-scraper',
      name: 'TikTok scraper',
      use: 'TikTok videos by hashtag or user.',
      exampleInput: { hashtags: ['policy'], resultsPerPage: 25 },
    },
  ];

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async execute(rawInput: Record<string, unknown>, _ctx: ToolExecutionContext) {
    const mode = typeof rawInput.mode === 'string' ? rawInput.mode : '';
    if (mode === 'list') {
      return { ok: true, catalog: this.catalog };
    }
    if (mode !== 'run') {
      return { ok: false, error: 'mode must be "list" or "run"' };
    }

    const token = this.config.get('APIFY_API_TOKEN', { infer: true });
    if (!token) {
      return {
        ok: false,
        configured: false,
        error:
          'Apify is not configured. Tell the user to add APIFY_API_TOKEN (Settings → Connectors → Apify).',
      };
    }

    const actorId = typeof rawInput.actorId === 'string' ? rawInput.actorId.trim() : '';
    if (!actorId) return { ok: false, error: 'actorId is required when mode=run' };
    const input =
      rawInput.input && typeof rawInput.input === 'object' && !Array.isArray(rawInput.input)
        ? (rawInput.input as Record<string, unknown>)
        : {};
    const maxItems = clamp(
      typeof rawInput.maxItems === 'number' ? Math.floor(rawInput.maxItems) : 25,
      1,
      100,
    );

    try {
      const url = new URL(
        `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`,
      );
      url.searchParams.set('token', token);
      // Cap the wait so a heavy actor doesn't pin the agent loop.
      url.searchParams.set('timeout', '60');
      url.searchParams.set('memory', '512');
      url.searchParams.set('clean', 'true');
      url.searchParams.set('limit', String(maxItems));

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        // Client cap slightly above server cap so we don't kill a run
        // the server is about to return.
        signal: AbortSignal.timeout(70_000),
      });
      if (!res.ok) {
        const body = await res.text();
        return {
          ok: false,
          error: `apify ${res.status}: ${body.slice(0, 300)}`,
          hint: 'If 400, the actor input shape is probably wrong — call mode="list" for examples.',
        };
      }
      const items = (await res.json()) as unknown[];
      return {
        ok: true,
        actorId,
        itemCount: items.length,
        items,
      };
    } catch (err) {
      this.logger.warn(`apify run failed: ${String(err)}`);
      return { ok: false, error: `Apify unreachable: ${String(err).slice(0, 200)}` };
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
