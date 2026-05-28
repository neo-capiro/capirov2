/**
 * Crawl service leadership/org-chart pages with Firecrawl and extract
 * candidate acquisition personnel records + headshot URLs (if available).
 *
 * Usage:
 *   pnpm --filter @capiro/api sync:dod-orgcharts
 *
 * Required env:
 *   FIRECRAWL_API_KEY=...
 *
 * Optional env:
 *   FIRECRAWL_BASE_URL=https://api.firecrawl.dev/v1
 *   DOD_ORGCHARTS_OUTPUT_DIR=./tmp/orgcharts
 *   DOD_ORGCHARTS_UPLOAD_S3=1
 *   DOD_ORGCHARTS_S3_BUCKET=capiro-scraped-data-967807252336-us-east-1
 *   DOD_ORGCHARTS_S3_PREFIX=pe-watch/orgcharts
 *   AWS_REGION / AWS_REGION_DEFAULT
 */
import { config as dotenvConfig } from 'dotenv';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FirecrawlClient } from '../src/clio/sources/firecrawl.client.js';

dotenvConfig();

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY ?? '';
const FIRECRAWL_BASE_URL = process.env.FIRECRAWL_BASE_URL ?? 'https://api.firecrawl.dev/v1';
const OUTPUT_DIR = process.env.DOD_ORGCHARTS_OUTPUT_DIR ?? './tmp/orgcharts';
const REQUEST_DELAY_MS = 1_000;

const UPLOAD_S3 = (process.env.DOD_ORGCHARTS_UPLOAD_S3 ?? '1') !== '0';
const S3_BUCKET = process.env.DOD_ORGCHARTS_S3_BUCKET ?? 'capiro-scraped-data-967807252336-us-east-1';
const S3_PREFIX = (process.env.DOD_ORGCHARTS_S3_PREFIX ?? 'pe-watch/orgcharts').replace(/^\/+|\/+$/g, '');
const AWS_REGION = process.env.AWS_REGION ?? process.env.AWS_REGION_DEFAULT ?? 'us-east-1';

const SOURCES = [
  { key: 'asaalt_army', url: 'https://www.asaalt.army.mil/' },
  { key: 'navair_navy', url: 'https://www.navair.navy.mil/' },
  { key: 'navsea_navy', url: 'https://www.navsea.navy.mil/' },
  { key: 'aflcmc_air_force', url: 'https://www.aflcmc.af.mil/' },
  { key: 'ssc_space_force', url: 'https://www.ssc.spaceforce.mil/' },
  { key: 'marcorsyscom_marines', url: 'https://www.marcorsyscom.marines.mil/' },
  { key: 'darpa_people', url: 'https://www.darpa.mil/about-us/people' },
] as const;

type SourceKey = (typeof SOURCES)[number]['key'];

type CandidatePersonnel = {
  source: SourceKey;
  sourceUrl: string;
  fullName: string;
  title: string | null;
  confidence: 'high' | 'medium' | 'low';
  headshotUrl: string | null;
  snippet: string;
};

type MarkdownImageRef = {
  lineIndex: number;
  url: string;
};

const UI_STOP_WORDS = new Set([
  'all',
  'offices',
  'roles',
  'filters',
  'sort',
  'read',
  'bio',
  'video',
  'audio',
  'close',
  'modal',
  'dialog',
  'player',
  'loading',
  'default',
  'selected',
  'menu',
  'search',
  'home',
  'contact',
  'play',
  'track',
]);

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function normalizeUrl(raw: string | null | undefined, sourceUrl: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, sourceUrl).toString();
  } catch {
    return null;
  }
}

function isLikelyImageUrl(url: string): boolean {
  return /\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?|#|$)/i.test(url);
}

function isLikelyHeadshotUrl(url: string): boolean {
  if (!isLikelyImageUrl(url)) return false;
  return /(lead|leader|people|person|profile|headshot|staff|bio|portrait)/i.test(url);
}

function parseMarkdownImageRefs(markdown: string, sourceUrl: string): MarkdownImageRef[] {
  const refs: MarkdownImageRef[] = [];
  const lines = markdown.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const inlineMatches = Array.from(line.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g));
    for (let j = 0; j < inlineMatches.length; j += 1) {
      const match = inlineMatches[j];
      const normalized = normalizeUrl(match?.[1] ?? null, sourceUrl);
      if (!normalized || !isLikelyImageUrl(normalized)) continue;
      refs.push({ lineIndex: i, url: normalized });
    }

    const bareMatches = Array.from(line.matchAll(/\bhttps?:\/\/[^\s)"']+\.(?:jpg|jpeg|png|webp|gif|avif)(?:\?[^\s)"']*)?/gi));
    for (let j = 0; j < bareMatches.length; j += 1) {
      const match = bareMatches[j];
      const normalized = normalizeUrl(match?.[0] ?? null, sourceUrl);
      if (!normalized) continue;
      refs.push({ lineIndex: i, url: normalized });
    }
  }

  return refs;
}

function pickHeadshotNearLine(images: MarkdownImageRef[], lineIndex: number): string | null {
  const nearby = images
    .map((img) => ({ ...img, dist: Math.abs(img.lineIndex - lineIndex) }))
    .filter((img) => img.dist <= 4)
    .sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      const aHead = isLikelyHeadshotUrl(a.url) ? 1 : 0;
      const bHead = isLikelyHeadshotUrl(b.url) ? 1 : 0;
      return bHead - aHead;
    });

  if (!nearby.length) return null;
  const firstHeadshot = nearby.find((img) => isLikelyHeadshotUrl(img.url));
  return firstHeadshot?.url ?? null;
}

function isLikelyName(line: string): boolean {
  const cleaned = line
    .replace(/^[#>\-•*\d.)\s]+/, '')
    .replace(/\[[^\]]+\]\([^)]*\)/g, '')
    .trim();
  if (!cleaned || cleaned.length < 5 || cleaned.length > 80) return false;
  if (cleaned.includes('http://') || cleaned.includes('https://')) return false;
  if (/\d{4,}/.test(cleaned)) return false;
  if (!/^[A-Za-z.,'\-\s]+$/.test(cleaned)) return false;
  if (/:/.test(cleaned)) return false;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  if (words.some((word) => UI_STOP_WORDS.has(word.toLowerCase()))) return false;

  const caps = words.filter((w) => /^[A-Z][a-zA-Z'\-.]+$/.test(w));
  return caps.length >= 2;
}

function cleanTitle(line: string): string {
  return normalizeWhitespace(line.replace(/^[\-•*\d.)\s]+/, '').replace(/^[-:–—]+\s*/, ''));
}

function isLikelyTitleLine(line: string): boolean {
  if (!line) return false;
  if (line.length > 140) return false;
  if (line.includes('http://') || line.includes('https://')) return false;
  if (/\[[^\]]+\]\([^)]*\)/.test(line)) return false;
  const lower = line.toLowerCase();
  if (Array.from(UI_STOP_WORDS).some((word) => lower.includes(word))) return false;
  return /program manager|deputy|director|officer|commander|chief|executive|innovation fellow|major|capt\.|col\.|lt\.|dr\./i.test(
    line,
  );
}

function extractPersonnel(source: SourceKey, sourceUrl: string, markdown: string): CandidatePersonnel[] {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .slice(0, 4000);

  const images = parseMarkdownImageRefs(markdown, sourceUrl);
  const out: CandidatePersonnel[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!isLikelyName(line)) continue;

    const next = lines[i + 1] ?? null;
    const prev = lines[i - 1] ?? null;

    let title: string | null = null;
    let confidence: CandidatePersonnel['confidence'] = 'low';

    if (next && /[A-Za-z]/.test(next) && !isLikelyName(next) && isLikelyTitleLine(next)) {
      title = cleanTitle(next);
      confidence = /PEO|Program Executive Officer|Program Manager|Deputy|Contracting Officer|Commander|Director/i.test(title)
        ? 'high'
        : 'medium';
    } else if (prev && /[A-Za-z]/.test(prev) && !isLikelyName(prev) && isLikelyTitleLine(prev)) {
      title = cleanTitle(prev);
      confidence = 'medium';
    }

    if (!title) continue;

    const fullName = line.replace(/^[\-•*\d.)\s]+/, '').trim();
    const dedupeKey = `${fullName.toLowerCase()}|${(title ?? '').toLowerCase()}|${source}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({
      source,
      sourceUrl,
      fullName,
      title,
      confidence,
      headshotUrl: pickHeadshotNearLine(images, i),
      snippet: [prev, line, next].filter(Boolean).join(' | ').slice(0, 500),
    });
  }

  return out;
}

function dedupePersonnel(items: CandidatePersonnel[]): CandidatePersonnel[] {
  const byKey = new Map<string, CandidatePersonnel>();
  const score = { high: 3, medium: 2, low: 1 } as const;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]!;
    const key = `${item.fullName.toLowerCase()}|${(item.title ?? '').toLowerCase()}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    const itemScore = score[item.confidence] + (item.headshotUrl ? 0.25 : 0);
    const existingScore = score[existing.confidence] + (existing.headshotUrl ? 0.25 : 0);
    if (itemScore > existingScore) byKey.set(key, item);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const c = score[b.confidence] - score[a.confidence];
    if (c !== 0) return c;
    return a.fullName.localeCompare(b.fullName);
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadJsonToS3(s3: S3Client, bucket: string, key: string, body: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json; charset=utf-8',
      ServerSideEncryption: 'AES256',
    }),
  );
}

async function uploadMarkdownToS3(s3: S3Client, bucket: string, key: string, body: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'text/markdown; charset=utf-8',
      ServerSideEncryption: 'AES256',
    }),
  );
}

async function main() {
  if (!FIRECRAWL_API_KEY.trim()) {
    throw new Error('FIRECRAWL_API_KEY env var is required');
  }

  const client = new FirecrawlClient(FIRECRAWL_API_KEY, FIRECRAWL_BASE_URL);
  const s3 = new S3Client({ region: AWS_REGION });
  const startedAt = Date.now();
  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const s3RunPrefix = `${S3_PREFIX}/${runStamp}`;

  await mkdir(OUTPUT_DIR, { recursive: true });

  const results: CandidatePersonnel[] = [];
  const pageHashes: Record<string, string> = {};

  console.log(`[orgcharts-sync] starting (${SOURCES.length} sources)`);
  console.log(`[orgcharts-sync] local output: ${path.resolve(OUTPUT_DIR)}`);
  if (UPLOAD_S3) {
    console.log(`[orgcharts-sync] s3 target: s3://${S3_BUCKET}/${s3RunPrefix}/`);
  }

  for (let i = 0; i < SOURCES.length; i += 1) {
    const source = SOURCES[i]!;
    try {
      await sleep(REQUEST_DELAY_MS);
      console.log(`[orgcharts-sync] scrape ${source.key} -> ${source.url}`);
      const doc = await client.scrape(source.url, {
        formats: ['markdown'],
        onlyMainContent: true,
        timeoutMs: 45_000,
      });

      const markdown = doc.markdown?.trim() ?? '';
      if (!markdown) {
        console.warn(`[orgcharts-sync] empty markdown for ${source.key}`);
        continue;
      }

      pageHashes[source.url] = sha256(markdown);
      const extracted = extractPersonnel(source.key, source.url, markdown);
      const withHeadshot = extracted.filter((row) => !!row.headshotUrl).length;
      console.log(`[orgcharts-sync] ${source.key}: ${extracted.length} candidates (${withHeadshot} with headshot URLs)`);
      results.push(...extracted);

      const localMdPath = path.join(OUTPUT_DIR, `${source.key}.md`);
      await writeFile(localMdPath, markdown, 'utf8');

      if (UPLOAD_S3) {
        const mdKey = `${s3RunPrefix}/raw/${source.key}.md`;
        await uploadMarkdownToS3(s3, S3_BUCKET, mdKey, markdown);
      }
    } catch (error) {
      console.warn(`[orgcharts-sync] ${source.key} failed: ${(error as Error).message}`);
    }
  }

  const deduped = dedupePersonnel(results);
  const withHeadshots = deduped.filter((item) => !!item.headshotUrl).length;

  const payload = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      sourceCount: SOURCES.length,
      candidateCount: deduped.length,
      candidateWithHeadshotCount: withHeadshots,
      pageHashes,
      candidates: deduped,
    },
    null,
    2,
  );

  const outPath = path.join(OUTPUT_DIR, 'acquisition-personnel-candidates.json');
  await writeFile(outPath, payload, 'utf8');

  if (UPLOAD_S3) {
    const jsonKey = `${s3RunPrefix}/acquisition-personnel-candidates.json`;
    await uploadJsonToS3(s3, S3_BUCKET, jsonKey, payload);
    console.log(`[orgcharts-sync] uploaded JSON -> s3://${S3_BUCKET}/${jsonKey}`);
  }

  console.log(`[orgcharts-sync] wrote ${deduped.length} candidates (${withHeadshots} with headshot URLs) -> ${outPath}`);
  console.log(`[orgcharts-sync] DONE in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error('[orgcharts-sync] FAILED', error);
  process.exit(1);
});
