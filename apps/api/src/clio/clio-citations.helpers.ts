/**
 * Pure helpers for Clio inline citations (P0-3).
 *
 * Flow: as tools return results we extract citation candidates and assign each a
 * stable 1-based marker number. Those numbered sources are injected into the
 * tool_result content fed back to the model (via `formatCitationsForPrompt`) so
 * the model cites them with `[N]` markers it did NOT invent. After the turn,
 * `validateCitationMarkers` keeps only `[N]` markers that map to a real source,
 * strips the rest (the model occasionally hallucinates marker numbers), and
 * returns the cleaned prose + the ordered list of citations actually used.
 *
 * Pure + dependency-free so it is unit-tested under the repo's `src/**.spec.ts`
 * matcher. The orchestrating service owns numbering state and I/O.
 */

export interface ClioCitation {
  /** 1-based marker number the model cites as `[n]`. */
  n: number;
  /** Source category, e.g. 'bill', 'lda_filing', 'web', derived from the tool. */
  type: string;
  /** Stable record identifier (best-effort) or '' when none is available. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Source URL when the record exposes one, else null. */
  url: string | null;
  /** Short grounding snippet, truncated, or null. */
  snippet: string | null;
  /** Originating tool name. */
  tool: string;
}

/** Map a Clio tool name to a citation `type` label. */
const TOOL_CITATION_TYPE: Readonly<Record<string, string>> = {
  search_congress_bills: 'bill',
  search_state_bills: 'state_bill',
  search_lda_filings: 'lda_filing',
  search_sec_filings: 'sec_filing',
  search_fara_registrations: 'fara_registration',
  search_federal_grants: 'grant',
  search_gao_reports: 'gao_report',
  search_crs_reports: 'crs_report',
  search_committee_hearings: 'hearing',
  search_intel_articles: 'news',
  query_economic_data: 'economic_data',
  query_intelligence: 'intelligence',
  search_public_web: 'web',
  scrape_web_page: 'web',
  search_research_sources: 'internal',
  get_client_context: 'client',
  search_client_knowledge: 'client_kb',
};

const TITLE_FIELDS = [
  'title',
  'name',
  'subject',
  'companyName',
  'registrantName',
  'identifier',
  'billNumber',
  'headline',
] as const;

const URL_FIELDS = [
  'url',
  'link',
  'htmlUrl',
  'sourceUrl',
  'pdfLink',
  'xmlLink',
  'billUrl',
  'documentUrl',
  'webUrl',
] as const;

const ID_FIELDS = [
  'id',
  'billId',
  'accessionNo',
  'accessionNumber',
  'identifier',
  'billNumber',
  'registrationNumber',
  'docId',
] as const;

const SNIPPET_FIELDS = [
  'summary',
  'description',
  'abstract',
  'snippet',
  'text',
  'latestAction',
  'excerpt',
] as const;

function firstString(rec: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const f of fields) {
    const v = rec[f];
    if (typeof v === 'string' && v.trim()) return v.trim();
    // Some fields (e.g. latestAction) are objects { text, actionDate }.
    if (v && typeof v === 'object') {
      const inner = (v as Record<string, unknown>).text;
      if (typeof inner === 'string' && inner.trim()) return inner.trim();
    }
  }
  return null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function rowsOf(payload: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(payload.data)) return payload.data as unknown[];
  if (Array.isArray(payload.results)) return payload.results as unknown[];
  return null;
}

/**
 * Extract up to `maxPerTool` citation candidates from one tool result, numbering
 * them from `startN`. Returns [] for errors, empty results, or non-record rows.
 */
export function extractCitationsFromToolResult(
  toolName: string,
  payload: unknown,
  startN: number,
  maxPerTool = 5,
): ClioCitation[] {
  if (!payload || typeof payload !== 'object') return [];
  const rec = payload as Record<string, unknown>;
  if (typeof rec.error === 'string') return [];
  const rows = rowsOf(rec);
  if (!rows || rows.length === 0) return [];

  const type = TOOL_CITATION_TYPE[toolName] ?? 'source';
  const out: ClioCitation[] = [];
  let n = startN;
  for (const row of rows) {
    if (out.length >= maxPerTool) break;
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const title = firstString(r, TITLE_FIELDS);
    if (!title) continue; // a citation with no title is not useful
    const url = firstString(r, URL_FIELDS);
    const id = firstString(r, ID_FIELDS) ?? '';
    const snippetRaw = firstString(r, SNIPPET_FIELDS);
    out.push({
      n,
      type,
      id,
      title: truncate(title, 200),
      url: url && /^https?:\/\//i.test(url) ? url : null,
      snippet: snippetRaw ? truncate(snippetRaw, 240) : null,
      tool: toolName,
    });
    n += 1;
  }
  return out;
}

/**
 * Render a compact, model-facing list of citable sources to prepend to a
 * tool_result so the model cites them with the exact `[N]` we assigned.
 */
export function formatCitationsForPrompt(citations: ClioCitation[]): string {
  if (citations.length === 0) return '';
  const lines = citations.map((c) => {
    const bits = [c.title];
    if (c.snippet) bits.push(c.snippet);
    if (c.url) bits.push(c.url);
    return `[${c.n}] ${bits.join(' — ')}`;
  });
  return `Citable sources (cite these in prose as [N] when you use them):\n${lines.join('\n')}`;
}

const MARKER_RE = /\[(\d{1,3})\]/g;

/**
 * Partition `[N]` markers in `text` into those that map to a real citation and
 * those that do not. Strips unmatched markers from the prose and returns the
 * cleaned text plus the citations actually used, in first-appearance order.
 */
export function validateCitationMarkers(
  text: string,
  citations: ClioCitation[],
): { used: ClioCitation[]; dropped: number[]; cleanedText: string } {
  const byN = new Map<number, ClioCitation>();
  for (const c of citations) byN.set(c.n, c);

  const usedNs: number[] = [];
  const dropped: number[] = [];
  const cleanedText = text.replace(MARKER_RE, (whole, digits: string) => {
    const num = Number(digits);
    if (byN.has(num)) {
      if (!usedNs.includes(num)) usedNs.push(num);
      return whole; // keep valid marker
    }
    dropped.push(num);
    return ''; // strip hallucinated marker
  });

  const used = usedNs.map((num) => byN.get(num)!);
  return { used, dropped, cleanedText };
}
