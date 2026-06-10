/**
 * Pure helpers for the `save_memory` Clio tool — normalizing an explicit
 * "remember this" request into a ClioMemory row shape.
 *
 * Kept pure (no I/O) so it is unit-tested under the repo's `src/**.spec.ts`
 * matcher. The tool handler in clio-tools.service.ts owns the DB write + embed.
 *
 * The key scheme MUST match ClioService.userScopedMemoryKey so explicit and
 * auto-extracted memories share one namespace, and so the embedding UPDATE
 * (which matches on tenant_id + key only) targets exactly one row.
 */

export type ClioMemoryScope = 'firm' | 'user_private';

export interface ClioMemoryRecord {
  scope: ClioMemoryScope;
  ownerUserId: string | null;
  /** Tenant-unique storage key (user-scoped keys are namespaced by userId). */
  key: string;
  value: string;
  source: string;
}

/** Mirror of ClioService.userScopedMemoryKey — keep the format identical. */
export function userScopedMemoryKey(userId: string, key: string): string {
  return `user:${userId}:${key}`;
}

/** Slugify a topic/key into a stable, bounded token. */
export function memoryKeySlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'note';
}

/**
 * Build a normalized ClioMemory record from a `save_memory` request. Returns
 * null when there is no usable content. `scope` of "firm" stores firm-wide;
 * anything else (default) stores as this user's private memory.
 */
export function buildSavedMemoryRecord(opts: {
  content: string;
  key?: string | null;
  scope?: string | null;
  userId: string;
}): ClioMemoryRecord | null {
  const value = (opts.content ?? '').trim();
  if (!value) return null;

  const scope: ClioMemoryScope =
    (opts.scope ?? '').trim().toLowerCase() === 'firm' ? 'firm' : 'user_private';

  // Explicit key wins; otherwise derive a slug from the first words of content.
  const rawKey = opts.key && opts.key.trim() ? opts.key : value.split(/\s+/).slice(0, 8).join(' ');
  const baseKey = memoryKeySlug(rawKey);
  const key = scope === 'user_private' ? userScopedMemoryKey(opts.userId, baseKey) : baseKey;

  return {
    scope,
    ownerUserId: scope === 'user_private' ? opts.userId : null,
    key,
    value: value.slice(0, 4000),
    source: 'user_requested',
  };
}

/** Extract lowercase keyword tokens (>=5 chars) from a query for memory matching. */
export function extractMemoryKeywords(text: string): string[] {
  return Array.from(
    new Set(
      (text ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 5),
    ),
  ).slice(0, 20);
}

export interface RankableMemory {
  key: string;
  value: string;
}

/**
 * Keyword-rank a set of memories against a query, used as the fallback when the
 * semantic (embedding) search is unavailable or returns nothing — so a stored
 * memory is NEVER silently invisible just because embeddings failed.
 *
 * Behaviour:
 *  - Score each memory by how many distinct query keywords appear in its
 *    `key + value`; higher overlap ranks first, ties broken by input order
 *    (callers pass memories already sorted newest-first).
 *  - If NOTHING matches (no keywords, or no overlap), fall back to the most
 *    recent `limit` memories rather than returning an empty list. Recent firm
 *    knowledge is better than nothing and matches user expectation that Clio
 *    "remembers".
 */
export function rankMemoriesByKeyword<T extends RankableMemory>(
  memories: T[],
  query: string,
  limit = 8,
): T[] {
  const words = extractMemoryKeywords(query);
  if (words.length === 0) return memories.slice(0, limit);

  const scored = memories
    .map((m, index) => {
      const haystack = `${m.key} ${m.value}`.toLowerCase();
      let score = 0;
      for (const w of words) if (haystack.includes(w)) score++;
      return { m, score, index };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((s) => s.m);

  if (scored.length > 0) return scored.slice(0, limit);
  // Nothing matched — never go fully blind; return the most recent memories.
  return memories.slice(0, limit);
}
