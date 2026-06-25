// Institutional Memory — markdown -> store parse-back (the "parse" half of the
// dual representation). Pure functions, no I/O, fully unit-testable.
//
// Reads an Obsidian-format markdown document (as produced by the renderer, then
// possibly edited by a human) back into the canonical structures:
//   - parseFrontmatter:  YAML header -> partial MemoryItem fields.
//   - parseSections:     headings + GENERATED fences -> MemorySection[] with
//                        correct owner (engine vs human).
//   - extractWikiLinks:  `[[type:slug]]` -> WikiLink[] for graph edges.
//
// This is the genuinely new, higher-risk half of the design (plan §0.5). The
// round-trip test (render -> parse -> render) pins criterion #9.

import type {
  MemoryItemType,
  MemoryProvenance,
  MemorySection,
  MemorySource,
  MemoryVisibility,
  WikiLink,
} from './memory.types.js';

export interface ParsedFrontmatter {
  type: MemoryItemType;
  schemaVersion: number;
  tenantId: string;
  entityId: string | null;
  visibility: MemoryVisibility;
  ownerUserId: string | null;
  clientId: string | null;
  slug: string;
  title: string;
  aliases: string[];
  tags: string[];
  source: MemorySource;
  sourceRef: string | null;
  createdAt: string;
  updatedAt: string;
  provenance: MemoryProvenance;
}

const GEN_BEGIN_RE = /^<!-- BEGIN GENERATED: (.+?) -->$/;
const GEN_END_RE = /^<!-- END GENERATED: (.+?) -->$/;

/** Split a document into [frontmatterText, bodyText]. Throws if no frontmatter. */
export function splitDocument(md: string): { frontmatter: string; body: string } {
  const lines = md.split('\n');
  if (lines[0] !== '---') {
    throw new Error('memory document missing leading frontmatter fence');
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error('memory document frontmatter not terminated');
  return {
    frontmatter: lines.slice(1, end).join('\n'),
    body: lines.slice(end + 1).join('\n'),
  };
}

function unquoteScalar(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"') || s.startsWith("'")) {
    try {
      return JSON.parse(s.replace(/^'/, '"').replace(/'$/, '"'));
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

function parseList(raw: string): string[] {
  const s = raw.trim();
  if (s === '[]' || s === '') return [];
  const inner = s.replace(/^\[/, '').replace(/\]$/, '');
  if (inner.trim() === '') return [];
  return inner.split(',').map((i) => unquoteScalar(i));
}

function nullable(raw: string): string | null {
  const s = raw.trim();
  return s === 'null' || s === '' ? null : s;
}

/** Parse the YAML frontmatter block. Tolerates the renderer's exact output. */
export function parseFrontmatter(frontmatter: string): ParsedFrontmatter {
  const map = new Map<string, string>();
  for (const line of frontmatter.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    map.set(key, val);
  }
  const req = (k: string): string => {
    const v = map.get(k);
    if (v === undefined) throw new Error(`frontmatter missing required key: ${k}`);
    return v;
  };
  // tenant_id is the non-negotiable scoping key (criterion #3).
  const tenantId = nullable(req('tenant_id'));
  if (tenantId === null) {
    throw new Error('frontmatter tenant_id must not be null — scoping key');
  }
  return {
    type: req('type') as MemoryItemType,
    schemaVersion: parseInt(req('schema_version'), 10),
    tenantId,
    entityId: nullable(req('entity_id')),
    visibility: req('visibility') as MemoryVisibility,
    ownerUserId: nullable(req('owner')),
    clientId: nullable(req('client_id')),
    slug: unquoteScalar(req('slug')),
    title: unquoteScalar(req('title')),
    aliases: parseList(req('aliases')),
    tags: parseList(req('tags')),
    source: req('source') as MemorySource,
    sourceRef: nullable(req('source_ref')),
    createdAt: req('created'),
    updatedAt: req('updated'),
    provenance: req('generated_by') as MemoryProvenance,
  };
}

/**
 * Parse the body into typed sections. A `## Heading` starts a section; if its
 * content is wrapped in BEGIN/END GENERATED fences the section is engine-owned,
 * otherwise human-owned. The fence key becomes the section key; for human
 * sections the key is derived from the heading slug.
 */
export function parseSections(body: string): MemorySection[] {
  const lines = body.split('\n');
  const sections: MemorySection[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const headingMatch = /^## (.+)$/.exec(line);
    if (!headingMatch) {
      i++;
      continue;
    }
    const heading = (headingMatch[1] ?? '').trim();
    i++;
    // Skip a single blank line after the heading.
    if (i < lines.length && (lines[i] ?? '').trim() === '') i++;

    const beginMatch = i < lines.length ? GEN_BEGIN_RE.exec(lines[i] ?? '') : null;
    if (beginMatch) {
      const key = beginMatch[1] ?? headingToKey(heading);
      i++;
      const bodyLines: string[] = [];
      while (i < lines.length && !GEN_END_RE.test(lines[i] ?? '')) {
        bodyLines.push(lines[i] ?? '');
        i++;
      }
      i++; // consume END line
      sections.push({
        key,
        heading,
        owner: 'engine',
        body: bodyLines.join('\n').trimEnd(),
      });
    } else {
      const bodyLines: string[] = [];
      while (i < lines.length && !/^## /.test(lines[i] ?? '')) {
        bodyLines.push(lines[i] ?? '');
        i++;
      }
      sections.push({
        key: headingToKey(heading),
        heading,
        owner: 'human',
        body: bodyLines.join('\n').trimEnd(),
      });
    }
  }
  return sections;
}

/** Deterministic key from a heading (human sections have no fence key). */
export function headingToKey(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract all typed wikilinks `[[type:slug]]` from arbitrary markdown text.
 * Used to derive graph edges (criterion #5). De-duplicated, order-preserving.
 */
export function extractWikiLinks(md: string): WikiLink[] {
  const re = /\[\[([a-z0-9-]+):([A-Za-z0-9._-]+)\]\]/g;
  const seen = new Set<string>();
  const out: WikiLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const type = m[1];
    const slug = m[2];
    if (type === undefined || slug === undefined) continue;
    const key = `${type}:${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, slug });
  }
  return out;
}
