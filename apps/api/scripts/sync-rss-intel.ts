/**
 * Sync RSS feeds from news outlets, agency press, think tanks, committees.
 *   pnpm --filter @capiro/api sync:rss
 * No auth required. Just RSS/Atom feeds.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
dotenvConfig();

const DELAY_MS = 300;

const FEEDS = [
  // News outlets
  { source: 'roll_call', url: 'https://rollcall.com/feed/' },
  { source: 'the_hill', url: 'https://thehill.com/feed/' },
  { source: 'politico', url: 'https://rss.politico.com/politics-news.xml' },
  { source: 'politico_congress', url: 'https://rss.politico.com/congress.xml' },
  { source: 'axios', url: 'https://api.axios.com/feed/' },
  { source: 'reuters_politics', url: 'https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best&best-sectors=political-general' },
  // Agency press releases (verified May 2026)
  { source: 'dod', url: 'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?max=20&ContentType=1' },
  { source: 'hhs', url: 'https://www.hhs.gov/rss/news-releases.xml' },
  { source: 'usda', url: 'https://www.usda.gov/rss/latest-releases.xml' },
  { source: 'doj', url: 'https://www.justice.gov/feeds/opa/justice-news.xml' },
  { source: 'state_dept', url: 'https://www.state.gov/rss-feed/press-releases/feed/' },
  { source: 'commerce', url: 'https://www.commerce.gov/feeds/news' },
  { source: 'va', url: 'https://news.va.gov/feed/' },
  // Fixed URLs (old ones returned 404, these verified working)
  { source: 'doe', url: 'https://www.energy.gov/rss.xml' },
  { source: 'dhs', url: 'https://www.dhs.gov/rss.xml' },
  { source: 'heritage', url: 'https://www.heritage.org/rss' },
  { source: 'urban', url: 'https://www.urban.org/research/rss.xml' },
  { source: 'cato', url: 'https://www.cato.org/rss/recent-opeds' },
  // Think tanks
  { source: 'brookings', url: 'https://www.brookings.edu/feed/' },
  { source: 'aei', url: 'https://www.aei.org/feed/' },
  { source: 'bipartisan_policy', url: 'https://bipartisanpolicy.org/feed/' },
  // Removed (dead/404/WAF-blocked, no working alternative found):
  // whitehouse.gov, treasury, epa, sba, dot, cap, rand, cfr, third_way
];

function extractText(xml: string, tag: string): string | null {
  const cdataMatch = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.+?)\\]\\]><\/${tag}>`, 's'));
  if (cdataMatch) return cdataMatch[1].trim();
  const plainMatch = xml.match(new RegExp(`<${tag}>(.+?)<\/${tag}>`, 's'));
  return plainMatch ? plainMatch[1].replace(/<[^>]+>/g, '').trim() : null;
}

function extractCategories(item: string): string[] {
  const matches = [...item.matchAll(/<category[^>]*>(?:<!\[CDATA\[)?(.+?)(?:\]\]>)?<\/category>/g)];
  return matches.map(m => m[1].trim()).filter(Boolean).slice(0, 10);
}

function safeDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  const prisma = new PrismaClient();
  const t0 = Date.now();
  console.log('[rss-sync] starting');

  let totalArticles = 0;
  let feedsProcessed = 0;
  let feedsFailed = 0;

  for (const feed of FEEDS) {
    await new Promise((r) => setTimeout(r, DELAY_MS));
    try {
      const resp = await fetch(feed.url, {
        headers: { 'User-Agent': 'Capiro/1.0 (neo@capiro.ai)' },
        signal: AbortSignal.timeout(20000),
      });
      if (!resp.ok) { feedsFailed++; continue; }
      const xml = await resp.text();

      // Parse RSS items (works for both RSS 2.0 and Atom with fallback)
      const items = xml.split(/<item[ >]/).slice(1);
      const entries = items.length ? items : xml.split(/<entry[ >]/).slice(1);
      let feedCount = 0;

      for (const item of entries.slice(0, 30)) { // max 30 per feed
        const title = extractText(item, 'title');
        const link = extractText(item, 'link') || item.match(/href="([^"]+)"/)?.[1];
        const pubDate = extractText(item, 'pubDate') || extractText(item, 'published') || extractText(item, 'updated');
        const description = extractText(item, 'description') || extractText(item, 'summary') || extractText(item, 'content');
        const author = extractText(item, 'author') || extractText(item, 'dc:creator');

        if (!title || !link) continue;
        const url = link.startsWith('http') ? link : `https://${link}`;

        try {
          await (prisma as any).intelArticle.upsert({
            where: { url },
            update: { title, summary: description?.slice(0, 5000) || null, syncedAt: new Date() },
            create: {
              source: feed.source, feedUrl: feed.url, title, url,
              author: author?.slice(0, 200) || null,
              publishedAt: safeDate(pubDate) || new Date(),
              summary: description?.slice(0, 5000) || null,
              categories: extractCategories(item),
            },
          });
          feedCount++;
          totalArticles++;
        } catch { /* skip dupes or invalid data */ }
      }

      if (feedCount > 0) console.log(`[rss-sync] ${feed.source}: ${feedCount} articles`);
      feedsProcessed++;
    } catch (err) {
      console.warn(`[rss-sync] ${feed.source} failed: ${(err as Error).message}`);
      feedsFailed++;
    }
  }

  console.log(`[rss-sync] feeds: ${feedsProcessed} ok, ${feedsFailed} failed`);
  console.log(`[rss-sync] total: ${totalArticles} articles`);
  console.log(`[rss-sync] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await prisma.$disconnect();
}

main().catch((err) => { console.error('[rss-sync] FAILED', err); process.exit(1); });