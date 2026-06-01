/**
 * Pure, dependency-free helpers for assembling the Clio chat request to the
 * Anthropic Messages API: system-prompt content blocks, tool-schema cache
 * breakpoints, and streaming token-usage accounting.
 *
 * Everything here is a pure function so it can be unit-tested under the repo's
 * standard `src/**.spec.ts` jest matcher (jest does NOT scan `scripts/` or
 * `test/`). The orchestrating service (`clio.service.ts`) imports these; keep
 * all I/O, Prisma, and HTTP out of this file.
 *
 * Prompt caching (P0-1): Anthropic caches the request prefix up to and including
 * each `cache_control: { type: 'ephemeral' }` breakpoint. The cacheable prefix
 * order is tools -> system -> messages, so we place breakpoints on (a) the final
 * tool schema and (b) the static system base. Both are byte-identical across
 * turns, so turns 2..N within the 5-minute cache TTL read the prefix from cache
 * (response usage reports `cache_read_input_tokens > 0`) instead of re-encoding
 * it. We deliberately do NOT cache the dynamic system tail (intent guidance +
 * per-tenant context snapshot) or the messages, both of which vary per turn and
 * could otherwise leak tenant-specific content into a long-lived cache prefix.
 */

export interface EphemeralCacheControl {
  type: 'ephemeral';
}

export interface SystemTextBlock {
  type: 'text';
  text: string;
  cache_control?: EphemeralCacheControl;
}

export interface ClioTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

const EPHEMERAL: EphemeralCacheControl = { type: 'ephemeral' };

/**
 * Build the `system` field as an array of content blocks. The static `base`
 * goes first and (when caching is enabled) carries the cache breakpoint; the
 * per-turn `dynamic` tail, if present, follows WITHOUT a breakpoint so it never
 * busts the cached prefix. When `dynamic` is empty/whitespace it is omitted so
 * the cached prefix is exactly `base`.
 */
export function buildClioSystemBlocks(opts: {
  base: string;
  dynamic?: string;
  cacheEnabled: boolean;
}): SystemTextBlock[] {
  const base: SystemTextBlock = { type: 'text', text: opts.base };
  if (opts.cacheEnabled && opts.base.length > 0) {
    base.cache_control = EPHEMERAL;
  }
  const blocks: SystemTextBlock[] = [base];
  if (opts.dynamic && opts.dynamic.trim().length > 0) {
    blocks.push({ type: 'text', text: opts.dynamic });
  }
  return blocks;
}

/**
 * Return a NEW tool array with a single cache breakpoint on the LAST tool, so
 * Anthropic caches the entire (static) tool block. Never mutates the input
 * array or its elements (we shallow-clone every element). No-op shape when
 * caching is disabled or the list is empty.
 */
export function applyToolCacheControl<T extends object>(
  tools: T[],
  cacheEnabled: boolean,
): Array<T & { cache_control?: EphemeralCacheControl }> {
  const lastIndex = tools.length - 1;
  return tools.map((tool, index) => {
    if (cacheEnabled && index === lastIndex) {
      return { ...tool, cache_control: EPHEMERAL };
    }
    return { ...tool };
  });
}

/** A fresh zeroed usage accumulator. */
export function emptyUsage(): ClioTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

/**
 * Extract token usage from a single Anthropic streaming event.
 * - `message_start` carries `message.usage` with input + cache token counts
 *   (and an initial output count).
 * - `message_delta` carries `usage.output_tokens`, the cumulative output count
 *   for the in-flight message.
 * Returns `null` for events that carry no usage. Defensive against partial /
 * malformed events (everything coerces to a finite number or is omitted).
 */
export function readUsageFromStreamEvent(evt: unknown): Partial<ClioTokenUsage> | null {
  if (!evt || typeof evt !== 'object') return null;
  const e = evt as { type?: unknown; message?: { usage?: unknown }; usage?: unknown };

  if (e.type === 'message_start') {
    const usage = e.message?.usage;
    if (!usage || typeof usage !== 'object') return null;
    const u = usage as Record<string, unknown>;
    return {
      inputTokens: numOr0(u.input_tokens),
      outputTokens: numOr0(u.output_tokens),
      cacheReadInputTokens: numOr0(u.cache_read_input_tokens),
      cacheCreationInputTokens: numOr0(u.cache_creation_input_tokens),
    };
  }

  if (e.type === 'message_delta') {
    const usage = e.usage;
    if (!usage || typeof usage !== 'object') return null;
    const u = usage as Record<string, unknown>;
    if (u.output_tokens === undefined) return null;
    return { outputTokens: numOr0(u.output_tokens) };
  }

  return null;
}

/**
 * Fold a per-round usage delta into a running total. `message_delta` output
 * counts are cumulative WITHIN a round (not across rounds), so callers resolve a
 * round to a single `ClioTokenUsage` first, then add it here once per round.
 */
export function addUsage(acc: ClioTokenUsage, delta: Partial<ClioTokenUsage>): void {
  acc.inputTokens += delta.inputTokens ?? 0;
  acc.outputTokens += delta.outputTokens ?? 0;
  acc.cacheReadInputTokens += delta.cacheReadInputTokens ?? 0;
  acc.cacheCreationInputTokens += delta.cacheCreationInputTokens ?? 0;
}

/**
 * Apply a single stream event's usage onto the current round's accumulator.
 * `message_start` sets the input/cache fields (and a baseline output); later
 * `message_delta` events overwrite `outputTokens` with the cumulative count.
 */
export function applyRoundUsageEvent(round: ClioTokenUsage, evt: unknown): void {
  const u = readUsageFromStreamEvent(evt);
  if (!u) return;
  if (u.inputTokens !== undefined) round.inputTokens = u.inputTokens;
  if (u.cacheReadInputTokens !== undefined) round.cacheReadInputTokens = u.cacheReadInputTokens;
  if (u.cacheCreationInputTokens !== undefined)
    round.cacheCreationInputTokens = u.cacheCreationInputTokens;
  if (u.outputTokens !== undefined) round.outputTokens = u.outputTokens;
}

function numOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
