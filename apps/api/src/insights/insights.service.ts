import { Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

/**
 * Proxies the Capiro Substack RSS feed ("The Cycle") into clean JSON for the
 * marketing site's Insights page. Substack's feed blocks some server-to-server
 * fetchers and the browser can't fetch it cross-origin (CORS), so this endpoint
 * fetches server-side (verified reachable from the Capiro AWS network) and
 * returns JSON the page can consume directly.
 *
 * Response is cached in-memory for 1 hour so we don't hit Substack on every
 * page load; a stale-but-served fallback keeps the page populated if a refresh
 * fetch ever fails.
 */
export interface InsightItem {
  title: string;
  link: string;
  pubDate: string; // ISO 8601
  description: string;
  thumbnail: string | null;
}

const FEED_URL = 'https://capirohq.substack.com/feed';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FETCH_TIMEOUT_MS = 8000;
const MAX_ITEMS = 20;
// Browser-like UA — Substack is happier serving its feed to a real UA.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  private cache: { items: InsightItem[]; at: number } | null = null;

  async getInsights(): Promise<{ items: InsightItem[] }> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) {
      return { items: this.cache.items };
    }
    try {
      const items = await this.fetchAndParse();
      this.cache = { items, at: now };
      return { items };
    } catch (err) {
      this.logger.warn(`Insights feed refresh failed: ${(err as Error).message}`);
      // Serve stale cache rather than an empty page if we have one.
      if (this.cache) return { items: this.cache.items };
      return { items: [] };
    }
  }

  private async fetchAndParse(): Promise<InsightItem[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let xml: string;
    try {
      const res = await fetch(FEED_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`feed responded ${res.status}`);
      xml = await res.text();
    } finally {
      clearTimeout(timer);
    }

    const parsed = this.parser.parse(xml) as Record<string, unknown>;
    const channel = (parsed?.rss as Record<string, unknown>)?.channel as
      | Record<string, unknown>
      | undefined;
    const rawItems = channel?.item;
    const list = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

    return list.slice(0, MAX_ITEMS).map((it) => this.mapItem(it as Record<string, unknown>));
  }

  private mapItem(it: Record<string, unknown>): InsightItem {
    const str = (v: unknown): string =>
      typeof v === 'string' ? v : v == null ? '' : String(v);

    const title = str(it.title).trim();
    const link = str(it.link).trim();
    const pubRaw = str(it.pubDate).trim();
    let pubDate = '';
    if (pubRaw) {
      const d = new Date(pubRaw);
      pubDate = Number.isNaN(d.getTime()) ? pubRaw : d.toISOString();
    }

    // Description: prefer the plain <description>, strip tags + collapse space,
    // trim to a reasonable excerpt length.
    const rawDesc = str(it.description ?? it['content:encoded']);
    const description = rawDesc
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 280);

    return { title, link, pubDate, description, thumbnail: this.extractThumb(it, rawDesc) };
  }

  /** Pull a thumbnail from common RSS image carriers, else first <img> in body. */
  private extractThumb(it: Record<string, unknown>, rawDesc: string): string | null {
    const fromAttr = (node: unknown): string | null => {
      if (node && typeof node === 'object') {
        const url = (node as Record<string, unknown>)['@_url'];
        if (typeof url === 'string' && url) return url;
      }
      return null;
    };
    const enclosure = fromAttr(it.enclosure);
    if (enclosure) return enclosure;
    const media = fromAttr(it['media:content'] ?? it['media:thumbnail']);
    if (media) return media;
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(rawDesc);
    return m && m[1] ? m[1] : null;
  }
}
