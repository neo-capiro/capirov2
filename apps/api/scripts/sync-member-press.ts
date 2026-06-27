/**
 * Member press ingestion — pulls each congressional member's RSS feed and stores
 * the recent items (title + link + date + summary; NO full-article fetch) into
 * member_press_item. Powers the directory member-profile "News" tab, which reads
 * straight from the table (no live fetch on profile view).
 *
 *   pnpm --filter @capiro/api sync:member-press              # dry run (no writes)
 *   pnpm --filter @capiro/api sync:member-press -- --commit  # persist
 *
 * Scheduled every 3 days ~02:00 ET (EventBridge rule capiro-dev-sync-member-press,
 * see infra/cdk/lib/ingestion-schedule.ts + docs/plans/member-press-feed-ingestion.md).
 *
 * The member -> rssFeedUrl map is the curated S3 press overlay (member-press-v1.json,
 * keyed by bioguide_id) — the same file the API merges onto directory contacts.
 */
import { config as dotenvConfig } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
dotenvConfig();

const COMMIT = process.argv.includes('--commit');
const BUCKET = process.env.DIRECTORY_S3_BUCKET ?? 'updated-directory-967807252336-us-east-1';
const OVERLAY_KEY =
  process.env.DIRECTORY_PRESS_OVERLAY_KEY ?? 'UPDATED DIRECTORY/overlays/member-press-v1.json';
const REGION = process.env.AWS_REGION_DEFAULT ?? process.env.AWS_REGION ?? 'us-east-1';

const MAX_ITEMS = 25; // latest N per feed (feeds rarely carry more)
const CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 20_000;
const PRUNE_OLDER_THAN_DAYS = 180; // bound table growth
// Browser-like UA — several Senate WordPress feeds WAF-block a bare server UA.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

interface PressItem {
  title: string;
  link: string;
  publishedAt: Date | null;
  summary: string | null;
  source: string | null;
}

function extractText(xml: string, tag: string): string | null {
  const cdata = xml.match(
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'),
  );
  if (cdata) return cdata[1].trim();
  const plain = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return plain ? plain[1].trim() : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function hostOf(u: string): string | null {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function safeDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(decodeEntities(v).trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

// House Drupal (evo) feeds set <link> to a /node/N alias that 404s; the canonical
// /media/press-releases/... URL lives in the item body. Prefer it.
function canonicalLink(link: string, body: string): string {
  if (link && !/\/node\/\d+\/?$/i.test(link)) return link;
  const hrefs = [...body.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1] ?? '');
  const canonical = hrefs.find(
    (h) => /^https?:\/\//i.test(h) && /\/(media|news|press)[-/]/i.test(h),
  );
  return canonical ? decodeEntities(canonical).trim() : link;
}

// Prefer the clean Drupal "Summary" field when present; else strip the body to text.
function summarize(body: string): string | null {
  let s = body;
  const evo = body.match(/evo-summary[\s\S]*?field__item"[^>]*>([\s\S]*?)<\/div>/i);
  if (evo) s = evo[1];
  const text = decodeEntities(s.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 600) : null;
}

async function fetchItems(feedUrl: string, source: string | undefined): Promise<PressItem[]> {
  const resp = await fetch(feedUrl, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const xml = await resp.text();

  const isAtom = !/<item[ >]/.test(xml) && /<entry[ >]/.test(xml);
  const blocks = (isAtom ? xml.split(/<entry[ >]/) : xml.split(/<item[ >]/)).slice(1);
  if (!blocks.length) {
    // A valid feed with no current items (channel header only) -> 0 items, NOT an
    // error. Only a response that isn't a feed at all (e.g. an HTML block page) throws.
    if (/<rss|<feed|<rdf:RDF/i.test(xml)) return [];
    throw new Error('not a recognized RSS/Atom feed');
  }

  const host = hostOf(feedUrl);
  const items: PressItem[] = [];
  for (const block of blocks.slice(0, MAX_ITEMS)) {
    const title = decodeEntities(
      (extractText(block, 'title') ?? '').replace(/<[^>]+>/g, ' '),
    ).trim();
    let link =
      extractText(block, 'link') || block.match(/<link[^>]*\bhref=["']([^"']+)["']/i)?.[1] || '';
    const body =
      extractText(block, 'content:encoded') ||
      extractText(block, 'description') ||
      extractText(block, 'content') ||
      extractText(block, 'summary') ||
      '';
    link = canonicalLink(decodeEntities(link).trim(), body);
    if (!title || !link) continue;
    const pub =
      extractText(block, 'pubDate') ||
      extractText(block, 'published') ||
      extractText(block, 'updated') ||
      extractText(block, 'dc:date');
    items.push({
      title: title.slice(0, 500),
      link: link.startsWith('http') ? link : `https://${link.replace(/^\/+/, '')}`,
      publishedAt: safeDate(pub),
      summary: summarize(body),
      source: source || host,
    });
  }
  return items;
}

async function main() {
  const t0 = Date.now();
  const prisma = new PrismaClient();
  const s3 = new S3Client({ region: REGION });

  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: OVERLAY_KEY }));
  if (!obj.Body) throw new Error(`empty overlay at s3://${BUCKET}/${OVERLAY_KEY}`);
  const overlay = JSON.parse(await obj.Body.transformToString()) as {
    members?: Record<string, { rssFeedUrl?: string; newsPressUrl?: string; rssSource?: string }>;
  };
  const targets = Object.entries(overlay.members ?? {}).filter(([, v]) => v?.rssFeedUrl);
  console.log(`[member-press] overlay members with feed: ${targets.length} | commit=${COMMIT}`);

  let ok = 0;
  let failed = 0;
  let withItems = 0;
  let items = 0;
  const queue = [...targets];

  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [bioguide, v] = next;
      try {
        const parsed = await fetchItems(v.rssFeedUrl!, v.rssSource);
        if (parsed.length) withItems++;
        for (const it of parsed) {
          if (COMMIT) {
            await prisma.memberPressItem.upsert({
              where: { bioguideId_link: { bioguideId: bioguide, link: it.link } },
              update: {
                title: it.title,
                publishedAt: it.publishedAt,
                summary: it.summary,
                source: it.source,
                syncedAt: new Date(),
              },
              create: {
                bioguideId: bioguide,
                link: it.link,
                title: it.title,
                publishedAt: it.publishedAt,
                summary: it.summary,
                source: it.source,
              },
            });
          }
          items++;
        }
        ok++;
      } catch (err) {
        failed++;
        console.warn(
          `[member-press] ${bioguide} (${v.rssFeedUrl}) failed: ${(err as Error).message}`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  let pruned = 0;
  if (COMMIT) {
    const cutoff = new Date(Date.now() - PRUNE_OLDER_THAN_DAYS * 86_400_000);
    pruned = (await prisma.memberPressItem.deleteMany({ where: { publishedAt: { lt: cutoff } } }))
      .count;
  }

  console.log(
    `[member-press] feeds ok=${ok} failed=${failed} withItems=${withItems} | items ${COMMIT ? 'upserted' : 'parsed'}=${items} pruned=${pruned} | ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  if (!COMMIT) console.log('[member-press] DRY RUN — no writes. Pass --commit to persist.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[member-press] FAILED', err);
  process.exit(1);
});
