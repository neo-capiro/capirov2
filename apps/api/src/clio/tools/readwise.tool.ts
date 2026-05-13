import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/config.schema.js';
import type { Tool, ToolDefinition, ToolExecutionContext } from './tool.types.js';

/**
 * Readwise — surfaces the user's saved highlights from books, articles,
 * tweets, and Readwise Reader saves. Useful when the user references
 * "that thing I read about X" or wants Clio to ground a draft in their
 * own knowledge base.
 *
 * API ref: https://readwise.io/api_deets — uses the v2 export endpoint
 * + v2 highlights search. The export endpoint paginates by `pageCursor`.
 *
 * Auth: tenant-wide READWISE_API_KEY for now. Per-user OAuth equivalent
 * is a follow-up; Readwise doesn't expose OAuth, only personal tokens.
 */
@Injectable()
export class ReadwiseTool implements Tool {
  private readonly logger = new Logger(ReadwiseTool.name);
  readonly internal = false;

  readonly definition: ToolDefinition = {
    name: 'readwise',
    description:
      'Search and read the user\'s Readwise highlights — annotations from books, articles, tweets, and Reader saves. ' +
      'mode="search" runs a substring search across all highlights and returns matches with their source. ' +
      'mode="recent" lists the most recently saved highlights (use when the user asks "what have I been reading lately"). ' +
      'Use this whenever the user references their own notes, reading history, or asks Clio to draw on what they\'ve highlighted.',
    inputSchema: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: {
          type: 'string',
          enum: ['search', 'recent'],
          description: 'search: substring match against highlights. recent: most recent highlights.',
        },
        query: {
          type: 'string',
          description: 'Substring to search for. Required when mode=search. Case-insensitive.',
        },
        limit: {
          type: 'integer',
          description: 'Max highlights to return. Default 10, max 50.',
        },
      },
    },
  };

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async execute(rawInput: Record<string, unknown>, _ctx: ToolExecutionContext) {
    const key = this.config.get('READWISE_API_KEY', { infer: true });
    if (!key) {
      return {
        ok: false,
        configured: false,
        error:
          'Readwise is not configured. Tell the user to add a READWISE_API_KEY (Settings → Connectors → Readwise).',
      };
    }
    const limit = clamp(
      typeof rawInput.limit === 'number' ? Math.floor(rawInput.limit) : 10,
      1,
      50,
    );
    const mode = typeof rawInput.mode === 'string' ? rawInput.mode : '';
    try {
      // The /highlights/ endpoint returns highlights sorted by
      // updated_at desc. We pull a single page (page_size=100 cap) and
      // filter client-side. For larger libraries this is the wrong
      // shape; we'd want the /export endpoint with pageCursor. Good
      // enough for v1 with ~hundreds of highlights.
      const url = new URL('https://readwise.io/api/v2/highlights/');
      url.searchParams.set('page_size', '100');
      const res = await fetch(url, {
        headers: { authorization: `Token ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `readwise ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = (await res.json()) as {
        results?: Array<{
          id?: number;
          text?: string;
          note?: string;
          book_id?: number;
          url?: string | null;
          updated?: string;
        }>;
      };
      const all = (data.results ?? []).map((h) => ({
        id: h.id ?? 0,
        text: h.text ?? '',
        note: h.note ?? '',
        bookId: h.book_id ?? 0,
        sourceUrl: h.url ?? null,
        updatedAt: h.updated ?? '',
      }));

      let filtered = all;
      if (mode === 'search') {
        const q = typeof rawInput.query === 'string' ? rawInput.query.trim().toLowerCase() : '';
        if (!q) return { ok: false, error: 'query is required when mode=search' };
        filtered = all.filter(
          (h) => h.text.toLowerCase().includes(q) || h.note.toLowerCase().includes(q),
        );
      } else if (mode !== 'recent') {
        return { ok: false, error: 'mode must be "search" or "recent"' };
      }

      return {
        ok: true,
        count: filtered.length,
        scanned: all.length,
        highlights: filtered.slice(0, limit),
      };
    } catch (err) {
      this.logger.warn(`readwise call failed: ${String(err)}`);
      return { ok: false, error: `Readwise unreachable: ${String(err).slice(0, 200)}` };
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
