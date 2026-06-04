import * as fs from 'node:fs';
import { normalizeName } from '../normalization/name-normalizer.js';
import { PersonRecordInput } from '../types.js';

/**
 * DoW Directory Rev 6 importer (June 2026 edition).
 *
 * Consumes the offline-parsed JSON produced from "2026 DoW Directory Update 6.pdf"
 * (apps/api/scripts/__data__/dow_directory_v6/dow_v6_people.json) and feeds it
 * through the SAME acquisition-personnel writer + dedup engine the Stanford/Rev4
 * importer uses. This SUPERSEDES the Rev 4 source: re-running upserts persisters as
 * fresh source mentions (no dupes via nameKey) and adds the ~2k people new in Rev 6.
 *
 * PE alignment (the join): the directory carries no raw PE codes, but each person's
 * `programs_mentioned[]` are distinctive program names/acronyms (XM7, AMPV, IVAS).
 * We concatenate those into `programOfRecord`, which is exactly the field the
 * deterministic PE<->person matcher (program-element/matching/pe-person-matcher.ts)
 * reads — so generate-pe-person-candidates.ts can then propose high-precision
 * person->PE links for human review WITHOUT any matcher change.
 *
 * Idempotent: keyed on nameKey (DB uniqueness). Re-run => addSourceMention, not insert.
 */

export const DOW_V6_SOURCE = 'dow_directory_rev6_2026_06';
const OBSERVED_AT = new Date('2026-06-03T00:00:00Z');

export interface DowV6PersonJson {
  full_name: string;
  rank?: string | null;
  honorific?: string | null;
  suffix?: string | null;
  paygrade?: string | null;
  title?: string | null;
  role?: string | null;
  status?: string | null;
  service?: string | null;
  organization?: string | null;
  sub_organization?: string | null;
  duty_station?: string | null;
  programs_mentioned?: string[];
  public_profile_url?: string | null;
  link_type?: string | null;
  source_page?: number | null;
  source_section?: string | null;
  extraction_confidence?: number | null;
}

export interface PersonnelWriterLike {
  upsertPerson(
    record: PersonRecordInput,
    source: string,
    sourceUrl: string | undefined,
    snippet: string | undefined,
    observedAt: Date,
    confidence: number,
  ): Promise<{ inserted: boolean; person_id: string; mergedWith?: string }>;
  addSourceMention(
    personId: string,
    source: string,
    sourceUrl: string | undefined,
    snippet: string | undefined,
    observedAt: Date,
    confidence: number,
  ): Promise<boolean>;
  quarantine(rawRecord: unknown, reason: string, source: string): Promise<void>;
}

export interface DowV6ImportDeps {
  writer: PersonnelWriterLike;
  existingPersonByKey?: Map<string, string>;
  loadExistingByNameKey?: () => Promise<Array<[string, string]>>;
}

export interface DowV6ImportStats {
  persons_scanned: number;
  persons_inserted: number;
  persons_addSourceMentioned: number;
  persons_with_profile_url: number;
  persons_with_programs: number;
  quarantined_rows: number;
  by_link_type: Record<string, number>;
}

const SERVICE_MAP: Record<string, string> = {
  ARMY: 'ARMY', NAVY: 'NAVY', AF: 'AF', SF: 'SF', USMC: 'USMC',
  OSD: 'OSD', DARPA: 'DARPA', CONGRESS: 'CONGRESS', OTHER: 'OTHER',
};

function cleanLink(raw: string | null | undefined): string | undefined {
  const v = (raw ?? '').trim();
  if (!v) return undefined;
  if (!/^https?:\/\//i.test(v)) return undefined;
  return v;
}

/** Compose the org string: prefer sub_organization (more specific) with org as parent context. */
function composeOrganization(p: DowV6PersonJson): string | undefined {
  const parts = [p.sub_organization, p.organization].map((s) => (s ?? '').trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  // de-dup if sub === org
  if (parts.length === 2 && parts[0] === parts[1]) return parts[0];
  return parts.join(' — ');
}

/**
 * Pack distinctive program names into programOfRecord so the PE matcher sees them.
 * The matcher tokenizes [organization, title, programOfRecord]; programs are the
 * strongest PE-join signal. Section (managing CPE/PEO) is appended as supporting
 * context (it's the acquisition arm that holds the PE money).
 */
function composeProgramOfRecord(p: DowV6PersonJson): string | undefined {
  const progs = (p.programs_mentioned ?? []).map((s) => s.trim()).filter(Boolean);
  const section = (p.source_section ?? '').trim();
  const parts: string[] = [];
  if (progs.length) parts.push(progs.join('; '));
  if (section) parts.push(section);
  const out = parts.join(' | ');
  return out || undefined;
}

export function buildRecord(p: DowV6PersonJson): PersonRecordInput {
  const fullName = (p.full_name ?? '').trim();
  const organization = composeOrganization(p);
  const programOfRecord = composeProgramOfRecord(p);
  const programs = (p.programs_mentioned ?? []).map((s) => s.trim()).filter(Boolean);
  const service = p.service ? (SERVICE_MAP[p.service] ?? null) : null;
  const publicProfileUrl = cleanLink(p.public_profile_url);

  const metadata = {
    rank: p.rank ?? null,
    honorific: p.honorific ?? null,
    suffix: p.suffix ?? null,
    paygrade: p.paygrade ?? null,
    dutyStation: p.duty_station ?? null,
    subOrganization: p.sub_organization ?? null,
    directorySection: p.source_section ?? null,
    directoryPage: p.source_page ?? null,
    linkType: p.link_type ?? null,
    programs: programs.length ? programs : null,
    sourcePdfVersion: DOW_V6_SOURCE,
  };

  return {
    fullName,
    service,
    organization: organization ?? null,
    title: (p.title ?? '').trim() || null,
    role: p.role ?? null,
    programOfRecord: programOfRecord ?? null,
    programs: programs.length ? programs : null,
    publicProfileUrl: publicProfileUrl ?? null,
    metadata,
  };
}

export async function importDowDirectoryV6(jsonPath: string, deps: DowV6ImportDeps): Promise<DowV6ImportStats> {
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const people = JSON.parse(raw) as DowV6PersonJson[];

  // Idempotency: the dedup map keyed on nameKey (DB uniqueness) is the sole gate
  // (writer runs with a noOp matcher during import). ALWAYS reload from the DB at
  // entry so a second pass — in the same process or a later run — sees rows inserted
  // by the first pass and adds a source mention instead of a duplicate person.
  if (!deps.existingPersonByKey) deps.existingPersonByKey = new Map<string, string>();
  if (deps.loadExistingByNameKey) {
    for (const [nameKey, id] of await deps.loadExistingByNameKey()) {
      deps.existingPersonByKey.set(nameKey, id);
    }
  }
  const map = deps.existingPersonByKey;

  const stats: DowV6ImportStats = {
    persons_scanned: 0,
    persons_inserted: 0,
    persons_addSourceMentioned: 0,
    persons_with_profile_url: 0,
    persons_with_programs: 0,
    quarantined_rows: 0,
    by_link_type: {},
  };

  for (const p of people) {
    const fullName = (p.full_name ?? '').trim();
    // Skip vacancies and non-person rows — they carry no nameKey value.
    if (!fullName || fullName.toLowerCase() === 'vacant') continue;
    stats.persons_scanned += 1;

    const record = buildRecord(p);
    const sourceUrl = record.publicProfileUrl ?? undefined;
    const snippet = record.title ?? undefined;
    if (sourceUrl) stats.persons_with_profile_url += 1;
    if (p.link_type) stats.by_link_type[p.link_type] = (stats.by_link_type[p.link_type] ?? 0) + 1;
    if ((p.programs_mentioned ?? []).length) stats.persons_with_programs += 1;

    const key = normalizeName(fullName).nameKey;
    const existingId = map.get(key);

    if (existingId) {
      const added = await deps.writer.addSourceMention(existingId, DOW_V6_SOURCE, sourceUrl, snippet, OBSERVED_AT, 0.85);
      if (added) stats.persons_addSourceMentioned += 1;
      continue;
    }

    try {
      const result = await deps.writer.upsertPerson(record, DOW_V6_SOURCE, sourceUrl, snippet, OBSERVED_AT, 0.85);
      map.set(key, result.person_id || result.mergedWith || '');
      if (result.inserted) stats.persons_inserted += 1;
      else stats.persons_addSourceMentioned += 1;
    } catch {
      stats.quarantined_rows += 1;
    }
  }

  return stats;
}
