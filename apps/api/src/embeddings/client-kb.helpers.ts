/**
 * Pure helpers for the client knowledge base (assistant-parity F5).
 *
 * Four source types feed one indexing pipeline into context_embeddings (all
 * rows carry clientId): client_profile (overview tab), client_person,
 * client_facility, client_doc_chunk (EngagementAttachment text, chunked).
 * Retrieval is two-layer: the search_client_knowledge tool (pgvector top-k)
 * and an always-on snapshot injected into client-scoped conversations.
 *
 * Encrypted meeting notes are EXCLUDED by construction: the indexer reads
 * only Client / ClientPerson / ClientFacility / EngagementAttachment — the
 * MeetingNote table has no path into any of these builders (spec-covered).
 */

export const KB_SOURCE_TYPES = [
  'client_profile',
  'client_person',
  'client_facility',
  'client_doc_chunk',
] as const;

export type KbSourceType = (typeof KB_SOURCE_TYPES)[number];

/** ~1k tokens per chunk at chars/4. */
export const KB_CHUNK_CHARS = 4000;
export const KB_CHUNK_OVERLAP_RATIO = 0.15;
/** Per-document and per-client chunk quotas (v1 index-bloat guard). */
export const KB_MAX_CHUNKS_PER_DOC = 60;
export const KB_MAX_CHUNKS_PER_CLIENT = 2000;
/** Snapshot budget ≈1.2k tokens. */
export const KB_SNAPSHOT_MAX_CHARS = 4800;

/**
 * Chunk extracted document text (~1k tokens with 15% overlap), breaking on
 * whitespace near the boundary so words are never split.
 */
export function chunkDocumentText(
  text: string,
  chunkChars = KB_CHUNK_CHARS,
  overlapRatio = KB_CHUNK_OVERLAP_RATIO,
): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= chunkChars) return [clean];
  const step = Math.max(1, Math.floor(chunkChars * (1 - overlapRatio)));
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < KB_MAX_CHUNKS_PER_DOC) {
    let end = Math.min(clean.length, start + chunkChars);
    if (end < clean.length) {
      const lastBreak = clean.lastIndexOf(' ', end);
      if (lastBreak > start + chunkChars * 0.5) end = lastBreak;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    // Word-align the next start so no chunk begins mid-word; the backward
    // scan can only grow the overlap, never lose text.
    let next = start + step;
    const boundary = clean.lastIndexOf(' ', next);
    if (boundary > start) next = boundary + 1;
    start = next;
  }
  return chunks.filter((c) => c.length > 0);
}

/** Stable per-chunk source id: `<attachmentId>:<index>`. */
export function docChunkSourceId(attachmentId: string, index: number): string {
  return `${attachmentId}:${index}`;
}

/** SQL LIKE prefix matching every chunk of one attachment. */
export function docChunkSourceIdPrefix(attachmentId: string): string {
  return `${attachmentId}:%`;
}

// ── Text builders (what gets embedded) ─────────────────────────────────────

const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]).filter(Boolean) : []);

export function buildClientProfileText(client: {
  name: string;
  description: string | null;
  productDescription: string | null;
  sectorTag: string | null;
  issueCodes: unknown;
  uei: string | null;
  naicsCodes: unknown;
  pscCodes: unknown;
  intakeData?: unknown;
}): string {
  const intakeHighlights = (() => {
    if (!client.intakeData || typeof client.intakeData !== 'object') return null;
    const data = client.intakeData as Record<string, unknown>;
    const parts = Object.entries(data)
      .filter(([, v]) => typeof v === 'string' && (v as string).trim().length > 0)
      .slice(0, 8)
      .map(([k, v]) => `${k}: ${(v as string).trim()}`);
    return parts.length ? parts.join('; ') : null;
  })();
  const parts = [
    `Client profile: ${client.name}`,
    client.sectorTag ? `Sector: ${client.sectorTag}` : null,
    client.description,
    client.productDescription ? `Products/services: ${client.productDescription}` : null,
    arr(client.issueCodes).length ? `Issue codes: ${arr(client.issueCodes).join(', ')}` : null,
    client.uei ? `UEI: ${client.uei}` : null,
    arr(client.naicsCodes).length ? `NAICS: ${arr(client.naicsCodes).join(', ')}` : null,
    arr(client.pscCodes).length ? `PSC: ${arr(client.pscCodes).join(', ')}` : null,
    intakeHighlights ? `Intake highlights: ${intakeHighlights}` : null,
  ].filter(Boolean);
  return parts.join('\n');
}

export function buildClientPersonText(person: {
  clientName: string;
  name: string;
  title: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  lastContact: Date | null;
  notes: string | null;
}): string {
  const parts = [
    `${person.name} at ${person.clientName}`,
    person.title ? `Title: ${person.title}` : null,
    person.role ? `Role: ${person.role}` : null,
    person.email ? `Email: ${person.email}` : null,
    person.phone ? `Phone: ${person.phone}` : null,
    person.lastContact ? `Last contact: ${person.lastContact.toISOString().slice(0, 10)}` : null,
    person.notes,
  ].filter(Boolean);
  return parts.join('\n');
}

export function formatDistrict(state: string | null, district: string | null): string | null {
  if (!state) return null;
  return district ? `${state}-${district}` : state;
}

export function buildClientFacilityText(facility: {
  clientName: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  congressionalDistrict: string | null;
  employeeCount: number | null;
  notes: string | null;
}): string {
  const district = formatDistrict(facility.state, facility.congressionalDistrict);
  const parts = [
    `${facility.clientName} facility: ${facility.name}`,
    [facility.addressLine, facility.city, facility.state, facility.zip].filter(Boolean).join(', ') || null,
    district ? `Congressional district: ${district}` : null,
    facility.employeeCount != null ? `Employees: ${facility.employeeCount}` : null,
    facility.notes,
  ].filter(Boolean);
  return parts.join('\n');
}

export function buildDocChunkText(input: {
  clientName: string;
  fileName: string;
  chunk: string;
  chunkIndex: number;
  chunkCount: number;
  meetingSubject?: string | null;
}): string {
  const header = [
    `Document "${input.fileName}" (${input.clientName})`,
    input.chunkCount > 1 ? `part ${input.chunkIndex + 1} of ${input.chunkCount}` : null,
    input.meetingSubject ? `from meeting: ${input.meetingSubject}` : null,
  ]
    .filter(Boolean)
    .join(' — ');
  return `${header}\n${input.chunk}`;
}

// ── Snapshot assembly (always-on context for client-scoped chats) ──────────

export interface KbSnapshotInput {
  client: {
    name: string;
    description: string | null;
    productDescription: string | null;
    sectorTag: string | null;
    issueCodes: unknown;
    uei: string | null;
  };
  people: Array<{
    name: string;
    title: string | null;
    role: string | null;
    lastContact: Date | null;
  }>;
  facilities: Array<{
    name: string;
    city: string | null;
    state: string | null;
    congressionalDistrict: string | null;
    employeeCount: number | null;
  }>;
  recentDocs: Array<{ fileName: string; createdAt: Date }>;
}

export interface DistrictFootprint {
  district: string;
  facilityCount: number;
  employees: number | null;
  names: string[];
}

/** Facility footprint grouped by congressional district (member targeting). */
export function groupFacilitiesByDistrict(
  facilities: KbSnapshotInput['facilities'],
): DistrictFootprint[] {
  const byDistrict = new Map<string, DistrictFootprint>();
  for (const f of facilities) {
    const district = formatDistrict(f.state, f.congressionalDistrict) ?? 'unknown district';
    const entry = byDistrict.get(district) ?? {
      district,
      facilityCount: 0,
      employees: null,
      names: [],
    };
    entry.facilityCount += 1;
    if (f.employeeCount != null) entry.employees = (entry.employees ?? 0) + f.employeeCount;
    if (entry.names.length < 3) entry.names.push(f.name);
    byDistrict.set(district, entry);
  }
  return [...byDistrict.values()].sort((a, b) => b.facilityCount - a.facilityCount);
}

/**
 * The ≤~1.2k-token KB snapshot injected into client-scoped conversations:
 * profile digest, top people, facility footprint by district, recent docs.
 */
export function buildKbSnapshot(input: KbSnapshotInput): string {
  const lines: string[] = [`Client knowledge base — ${input.client.name}`];
  const profileBits = [
    input.client.sectorTag ? `Sector: ${input.client.sectorTag}` : null,
    input.client.description,
    input.client.productDescription ? `Products/services: ${input.client.productDescription}` : null,
    arr(input.client.issueCodes).length
      ? `Issue codes: ${arr(input.client.issueCodes).join(', ')}`
      : null,
    input.client.uei ? `UEI: ${input.client.uei}` : null,
  ].filter(Boolean) as string[];
  if (profileBits.length) lines.push(profileBits.join('. '));

  if (input.people.length) {
    lines.push(
      'Key people: ' +
        input.people
          .slice(0, 8)
          .map((p) => {
            const title = [p.title, p.role].filter(Boolean).join(', ');
            const last = p.lastContact
              ? ` (last contact ${p.lastContact.toISOString().slice(0, 10)})`
              : '';
            return `${p.name}${title ? ` — ${title}` : ''}${last}`;
          })
          .join('; '),
    );
  }

  const footprint = groupFacilitiesByDistrict(input.facilities);
  if (footprint.length) {
    lines.push(
      'Facility footprint by congressional district (who represents this client): ' +
        footprint
          .slice(0, 10)
          .map(
            (d) =>
              `${d.district}: ${d.names.join(', ')}${d.employees != null ? ` (~${d.employees} employees)` : ''}`,
          )
          .join(' | '),
    );
  }

  if (input.recentDocs.length) {
    lines.push(
      'Recent documents (retrievable via search_client_knowledge): ' +
        input.recentDocs
          .slice(0, 5)
          .map((d) => `${d.fileName} (${d.createdAt.toISOString().slice(0, 10)})`)
          .join('; '),
    );
  }
  lines.push(
    'Use the search_client_knowledge tool to retrieve specifics (people, facilities, document contents) before answering client questions.',
  );

  const text = lines.join('\n');
  return text.length > KB_SNAPSHOT_MAX_CHARS
    ? `${text.slice(0, KB_SNAPSHOT_MAX_CHARS).trimEnd()}…`
    : text;
}
