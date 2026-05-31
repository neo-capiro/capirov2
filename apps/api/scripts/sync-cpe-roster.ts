import { config as dotenvConfig } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FirecrawlClient } from '../src/clio/sources/firecrawl.client.js';

/**
 * sync-cpe-roster.ts
 *
 * Firecrawl-based ingester for Army CPE (Capability Program Executive, formerly PEO)
 * websites. Scrapes the leadership + PM pages of a CPE site and emits a roster
 * artifact in the shared peo_roster_*.json format that sync-peo-rosters.ts consumes.
 *
 * This is the AUTOMATION that replaces hand-downloading CPE org charts: the CPE
 * .mil sites WAF-block our direct egress (HTTP 000), but Firecrawl fetches them.
 *
 * Usage:
 *   tsx scripts/sync-cpe-roster.ts --url https://cpeisw.army.mil --org "CPE ISW" \
 *       --former "PEO IEW&S" [--out scripts/__data__/peo_roster_cpe_isw.json] [--print]
 *
 * Env: FIRECRAWL_API_KEY (from .env)
 *
 * Parsing model: CPE leadership pages render each principal as a markdown heading
 * with the person's NAME, immediately followed by their role/title lines, e.g.
 *     ## BG KEVIN CHANEY
 *     Capability Program Executive
 *     Intelligence and Spectrum Warfare
 * and PM cards as "PM <PORTFOLIO>" headings. We pull the obvious leadership block
 * (CPE + Deputy) deterministically; deeper PM rosters vary per site, so by default
 * we capture the CPE/Deputy reliably and list the PM portfolio headings as context.
 * Human review (the roster artifact is committed + reviewed) catches the rest.
 */

interface RosterPerson {
  fullName: string;
  rank?: string | null;
  role: string;
  roleTitle: string;
  programOfRecord?: string | null;
}

const RANKS = ['GEN', 'LTG', 'MG', 'BG', 'COL', 'LTC', 'MAJ', 'CPT', 'CW5', 'CW4', 'CW3', 'SGM', 'CSM', 'DR.', 'MR.', 'MS.', 'MRS.'];
const RANK_RE = new RegExp(`^(${RANKS.map((r) => r.replace('.', '\\.')).join('|')})\\s+`, 'i');

function arg(name: string, def?: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1]!.startsWith('--')) return process.argv[i + 1];
  return def;
}

function stripRank(name: string): { rank: string | null; full: string } {
  const m = RANK_RE.exec(name);
  if (!m) return { rank: null, full: name.trim() };
  return { rank: m[1]!.replace('.', '').toUpperCase(), full: name.replace(RANK_RE, '').trim() };
}

function looksLikeName(s: string): boolean {
  const c = s.replace(/[*_#]/g, '').trim();
  if (c.length < 5 || c.length > 70) return false;
  if (/https?:|\d{3,}|:/.test(c)) return false;
  const bare = c.replace(RANK_RE, '');
  const words = bare.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 5 && /^[A-Za-z.'\-\s]+$/.test(bare);
}

const ROLE_KEYWORDS = /capability program executive|deputy|project manager|product manager|product lead|project lead|director|chief|sergeant major|warrant officer|program executive/i;

function roleCode(title: string): string {
  const t = title.toLowerCase();
  if (/deputy (capability )?program executive|acting deputy/.test(t)) return 'DPEO';
  if (/capability program executive|program executive/.test(t)) return 'PEO';
  if (/deputy (project|product)/.test(t)) return 'DPM';
  if (/(project|product) (manager|lead)/.test(t)) return 'PM';
  if (/director|chief|sergeant major|warrant officer|officer/.test(t)) return 'STAFF';
  return 'OTHER';
}

/** Parse a CPE markdown page for NAME-heading -> following role/title lines. */
function parseLeadership(markdown: string): RosterPerson[] {
  const lines = markdown.split(/\r?\n/).map((l) => l.replace(/\\$/, '').trim());
  const people: RosterPerson[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const heading = raw.replace(/^#{1,6}\s*/, '').replace(/[*_]/g, '').trim();
    const isHeading = /^#{1,6}\s/.test(raw) || /^[A-Z][A-Z.'\- ]{6,}$/.test(heading);
    if (!isHeading || !looksLikeName(heading)) continue;
    // Skip section/portfolio headings that aren't people (OUR MISSION, PM <PORTFOLIO>, PD/CPE ...).
    if (/^(OUR |PM |PD |PDM |CPE |MISSION|VISION)/i.test(heading) && !RANK_RE.test(heading)) continue;
    // gather the next few non-empty lines as the role/title (blank lines separate them).
    const titleParts: string[] = [];
    for (let j = i + 1; j <= i + 6 && j < lines.length; j += 1) {
      const t = (lines[j] ?? '').replace(/[*_#]/g, '').trim();
      if (!t) continue;
      if (/^!\[|^\[|https?:/.test(t)) break; // image/link => end of this card
      // A line that is itself a new RANKED name-heading ends this card.
      if (RANK_RE.test(t) && looksLikeName(t)) break;
      titleParts.push(t);
      if (titleParts.join(' ').length > 100) break;
    }
    const roleTitle = titleParts.join(', ').replace(/,\s*,/g, ',').trim();
    if (!roleTitle || !ROLE_KEYWORDS.test(roleTitle)) continue;
    const { rank, full } = stripRank(heading);
    people.push({ fullName: titleCase(full), rank, role: roleCode(roleTitle), roleTitle });
  }
  // dedup by name
  const seen = new Set<string>();
  return people.filter((p) => {
    const k = p.fullName.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function titleCase(name: string): string {
  const keep = new Set(['II', 'III', 'IV', 'SES', 'JR', 'JR.', 'SR', 'SR.']);
  return name
    .split(/\s+/)
    .map((w) => (keep.has(w.replace(/[.,]/g, '').toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
    .replace(/,$/, '');
}

async function main(): Promise<void> {
  dotenvConfig();
  const url = arg('url');
  const org = arg('org');
  const former = arg('former') ?? null;
  const service = arg('service') ?? 'ARMY';
  const print = process.argv.includes('--print');
  if (!url || !org) {
    console.error('usage: sync-cpe-roster.ts --url <cpe-site> --org "CPE X" [--former "PEO X"] [--print]');
    process.exit(2);
  }
  const key = process.env.FIRECRAWL_API_KEY ?? '';
  if (!key.trim()) throw new Error('FIRECRAWL_API_KEY required');
  const client = new FirecrawlClient(key, process.env.FIRECRAWL_BASE_URL ?? 'https://api.firecrawl.dev/v1');

  // Scrape homepage (leadership block lives there) + /about/ for redundancy.
  const pages = [url, url.replace(/\/$/, '') + '/about/'];
  const all: RosterPerson[] = [];
  for (const p of pages) {
    try {
      const doc = await client.scrape(p, { formats: ['markdown'], onlyMainContent: true, timeoutMs: 60_000 });
      const md = doc.markdown ?? '';
      if (md) all.push(...parseLeadership(md));
    } catch (e) {
      console.error(`scrape failed ${p}: ${(e as Error).message}`);
    }
  }
  // dedup across pages
  const seen = new Set<string>();
  const people = all.filter((p) => {
    const k = p.fullName.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const roster = {
    org,
    formerName: former,
    service,
    source: `${url} (Firecrawl scrape)`,
    asOf: new Date().toISOString().slice(0, 10),
    stats: { people: people.length },
    people,
  };

  if (print) {
    console.log(JSON.stringify(roster, null, 2));
    return;
  }
  const slug = org.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const out = arg('out') ?? path.resolve('scripts/__data__', `peo_roster_${slug}.json`);
  fs.writeFileSync(out, JSON.stringify(roster, null, 2));
  console.log(`WROTE ${out} (${people.length} people)`);
}

void main();
