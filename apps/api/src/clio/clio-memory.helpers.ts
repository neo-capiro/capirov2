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
