import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/config.schema.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

/**
 * Reddit read-only via the unauthenticated JSON endpoints. No OAuth, no
 * API key. Reddit allows ~60 req/min from an unauthenticated client
 * with a proper User-Agent string. We send a User-Agent identifying
 * Capiro per Reddit's API rules.
 *
 * Three modes:
 *   - search: cross-subreddit query → posts.
 *   - subreddit: top posts in a specific subreddit.
 *   - comments: top comments on a specific post (by permalink path).
 *
 * Failure modes: Reddit 429s on rate-limit. We return a clear error and
 * let the model tell the user to retry. We do NOT auto-retry from the
 * tool — that hides the rate-limit problem and pins the agent loop.
 */
@Injectable()
export class RedditTool implements Tool {
  private readonly logger = new Logger(RedditTool.name);
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'reddit',
    description:
      'Search and read public Reddit content — the best place to see what real users actually think about a product, niche, person, or problem. ' +
      'mode="search" runs a query across all of Reddit and returns matching posts. ' +
      'mode="subreddit" lists hot/top posts in a specific subreddit. ' +
      'mode="comments" reads the top comments on a specific post (pass the post\'s permalink). ' +
      'Read-only — Clio cannot post or vote.',
    inputSchema: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: {
          type: 'string',
          enum: ['search', 'subreddit', 'comments'],
        },
        query: { type: 'string', description: 'Search query. Required when mode=search.' },
        subreddit: {
          type: 'string',
          description: 'Subreddit name without the r/. Required when mode=subreddit.',
        },
        sort: {
          type: 'string',
          enum: ['hot', 'top', 'new', 'relevance'],
          description: 'Sort order. Default: hot for subreddit, relevance for search.',
        },
        time: {
          type: 'string',
          enum: ['hour', 'day', 'week', 'month', 'year', 'all'],
          description: 'Time window for sort=top. Default: week.',
        },
        permalink: {
          type: 'string',
          description:
            'Reddit post permalink path (e.g. "/r/lobbyists/comments/abc123/title/"). Required when mode=comments.',
        },
        limit: { type: 'integer', description: 'Max results. Default 10, max 25.' },
      },
    },
  };

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async execute(rawInput: Record<string, unknown>, _ctx: ToolExecutionContext) {
    const userAgent = this.config.get('REDDIT_USER_AGENT', { infer: true });
    const mode = typeof rawInput.mode === 'string' ? rawInput.mode : '';
    const limit = clamp(
      typeof rawInput.limit === 'number' ? Math.floor(rawInput.limit) : 10,
      1,
      25,
    );

    if (mode === 'search') return this.search(rawInput, userAgent, limit);
    if (mode === 'subreddit') return this.subreddit(rawInput, userAgent, limit);
    if (mode === 'comments') return this.comments(rawInput, userAgent, limit);
    return { ok: false, error: 'mode must be "search", "subreddit", or "comments"' };
  }

  private async search(input: Record<string, unknown>, ua: string, limit: number) {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) return { ok: false, error: 'query is required when mode=search' };
    const sort = stringOr(input.sort, 'relevance');
    const time = stringOr(input.time, 'week');
    const url = new URL('https://www.reddit.com/search.json');
    url.searchParams.set('q', query);
    url.searchParams.set('sort', sort);
    url.searchParams.set('t', time);
    url.searchParams.set('limit', String(limit));
    return this.fetchListing(url, ua);
  }

  private async subreddit(input: Record<string, unknown>, ua: string, limit: number) {
    const sub = typeof input.subreddit === 'string' ? input.subreddit.trim() : '';
    if (!sub) return { ok: false, error: 'subreddit is required when mode=subreddit' };
    const sort = stringOr(input.sort, 'hot');
    const time = stringOr(input.time, 'week');
    const url = new URL(`https://www.reddit.com/r/${encodeURIComponent(sub)}/${sort}.json`);
    if (sort === 'top') url.searchParams.set('t', time);
    url.searchParams.set('limit', String(limit));
    return this.fetchListing(url, ua);
  }

  private async fetchListing(url: URL, ua: string) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': ua, accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) {
        return { ok: false, error: 'Reddit rate-limited the request. Try again in a minute.' };
      }
      if (!res.ok) {
        return { ok: false, error: `reddit ${res.status}` };
      }
      const data = (await res.json()) as {
        data?: { children?: Array<{ data?: Record<string, unknown> }> };
      };
      const posts = (data.data?.children ?? []).map((c) => {
        const p = c.data ?? {};
        return {
          title: stringOr(p.title, ''),
          author: stringOr(p.author, ''),
          subreddit: stringOr(p.subreddit, ''),
          score: numOr(p.score, 0),
          numComments: numOr(p.num_comments, 0),
          permalink: stringOr(p.permalink, ''),
          url: stringOr(p.url, ''),
          selfText: stringOr(p.selftext, '').slice(0, 1_500),
          createdUtc: numOr(p.created_utc, 0),
        };
      });
      return { ok: true, posts };
    } catch (err) {
      this.logger.warn(`reddit fetch failed: ${String(err)}`);
      return { ok: false, error: `Reddit unreachable: ${String(err).slice(0, 200)}` };
    }
  }

  private async comments(input: Record<string, unknown>, ua: string, limit: number) {
    const permalink = typeof input.permalink === 'string' ? input.permalink.trim() : '';
    if (!permalink) return { ok: false, error: 'permalink is required when mode=comments' };
    // Permalink looks like "/r/sub/comments/<id>/<slug>/" — append .json
    const path = permalink.endsWith('/') ? permalink.slice(0, -1) : permalink;
    const url = new URL(`https://www.reddit.com${path}.json`);
    url.searchParams.set('limit', String(limit));
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': ua, accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) {
        return { ok: false, error: 'Reddit rate-limited the request. Try again in a minute.' };
      }
      if (!res.ok) return { ok: false, error: `reddit ${res.status}` };
      // The endpoint returns [post, comments] tuple.
      const data = (await res.json()) as Array<{
        data?: { children?: Array<{ data?: Record<string, unknown> }> };
      }>;
      const post = data[0]?.data?.children?.[0]?.data ?? {};
      const comments = (data[1]?.data?.children ?? [])
        .map((c) => c.data ?? {})
        .filter((c) => typeof c.body === 'string')
        .slice(0, limit)
        .map((c) => ({
          author: stringOr(c.author, ''),
          score: numOr(c.score, 0),
          body: stringOr(c.body, '').slice(0, 2_000),
          createdUtc: numOr(c.created_utc, 0),
        }));
      return {
        ok: true,
        post: {
          title: stringOr(post.title, ''),
          author: stringOr(post.author, ''),
          score: numOr(post.score, 0),
          selfText: stringOr(post.selftext, '').slice(0, 2_000),
        },
        comments,
      };
    } catch (err) {
      this.logger.warn(`reddit comments fetch failed: ${String(err)}`);
      return { ok: false, error: `Reddit unreachable: ${String(err).slice(0, 200)}` };
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}
function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}
