/**
 * Pure helpers for extended thinking on the deep tier (assistant-parity F3).
 *
 * Deep-tier chat turns and research gather/synthesize calls request model
 * reasoning. Two modes:
 *  - 'adaptive' (default): the recommended mode on the Claude 4.6-family
 *    models Meri runs on (fixed thinking budgets are deprecated there); the
 *    model decides when and how much to think, and interleaved thinking
 *    between tool calls is automatic.
 *  - 'budget': sends `thinking: {type:'enabled', budget_tokens}` for pinned
 *    older models; max_tokens is raised so the budget never crowds out the
 *    visible answer (the API requires budget_tokens < max_tokens).
 *
 * Thinking text is ephemeral UI: streamed to the timeline, never persisted to
 * ClioMessage, never fed to the confidence checker, never included in
 * artifacts or docgen. The redaction guarantee lives in
 * stripThinkingBlocks() / containsThinkingBlocks(), spec-covered.
 *
 * With tool use, the API requires the thinking blocks of an assistant turn to
 * be replayed (with signatures) when that turn is appended back into the
 * conversation — thinkingReplayBlocks() rebuilds them in stream order.
 */

export type ThinkingMode = 'adaptive' | 'budget';

export interface ThinkingSettings {
  enabled: boolean;
  mode: ThinkingMode;
  budgetTokens: number;
}

export interface ThinkingRequestParams {
  /** `thinking` body param for the Messages API, or null to omit. */
  thinking: Record<string, unknown> | null;
  /** max_tokens to send (raised when thinking needs headroom). */
  maxTokens: number;
}

/**
 * Build the request params for a turn. Fast-tier turns are unchanged
 * (thinking omitted, baseline max_tokens) so the kill-switch and tier routing
 * both reduce to "exactly the old request".
 */
export function thinkingRequestParams(
  settings: ThinkingSettings,
  tier: 'fast' | 'deep',
  baseMaxTokens: number,
): ThinkingRequestParams {
  if (!settings.enabled || tier !== 'deep') {
    return { thinking: null, maxTokens: baseMaxTokens };
  }
  if (settings.mode === 'budget') {
    const budget = Math.max(1024, settings.budgetTokens);
    return {
      thinking: { type: 'enabled', budget_tokens: budget },
      // budget_tokens must be strictly less than max_tokens.
      maxTokens: baseMaxTokens + budget,
    };
  }
  return {
    thinking: { type: 'adaptive' },
    // Adaptive thinking spends from max_tokens; grant the same headroom so the
    // visible answer budget is preserved.
    maxTokens: baseMaxTokens + Math.max(0, settings.budgetTokens),
  };
}

// ── Streaming accumulation ───────────────────────────────────────────────

export interface ThinkingBlockAccum {
  index: number;
  kind: 'thinking' | 'redacted_thinking';
  thinking: string;
  signature: string;
  /** Opaque payload for redacted_thinking blocks. */
  data: string;
}

export interface ThinkingStreamState {
  blocks: ThinkingBlockAccum[];
}

export function createThinkingState(): ThinkingStreamState {
  return { blocks: [] };
}

export interface ThinkingEventResult {
  /** New visible reasoning text to relay to the UI (null if none). */
  thinkingTextDelta: string | null;
}

/**
 * Fold one Anthropic stream event into the thinking state. Returns any new
 * visible reasoning text so the caller can relay it over SSE. Unknown events
 * are ignored (text/tool_use handling stays where it is).
 */
export function applyThinkingStreamEvent(
  state: ThinkingStreamState,
  evt: { type?: unknown; index?: unknown; content_block?: unknown; delta?: unknown },
): ThinkingEventResult {
  const none: ThinkingEventResult = { thinkingTextDelta: null };
  const index = typeof evt.index === 'number' ? evt.index : null;
  if (evt.type === 'content_block_start' && index !== null) {
    const block = (evt.content_block ?? {}) as Record<string, unknown>;
    if (block.type === 'thinking') {
      state.blocks.push({ index, kind: 'thinking', thinking: '', signature: '', data: '' });
    } else if (block.type === 'redacted_thinking') {
      state.blocks.push({
        index,
        kind: 'redacted_thinking',
        thinking: '',
        signature: '',
        data: typeof block.data === 'string' ? block.data : '',
      });
    }
    return none;
  }
  if (evt.type === 'content_block_delta' && index !== null) {
    const delta = (evt.delta ?? {}) as Record<string, unknown>;
    const block = state.blocks.find((b) => b.index === index);
    if (!block) return none;
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      block.thinking += delta.thinking;
      return { thinkingTextDelta: delta.thinking };
    }
    if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
      block.signature += delta.signature;
      return none;
    }
  }
  return none;
}

/**
 * Rebuild the thinking blocks of this round's assistant turn, in stream
 * order, for replay in the agentic loop. Must come before tool_use blocks in
 * the assistant content array.
 */
export function thinkingReplayBlocks(state: ThinkingStreamState): Array<Record<string, unknown>> {
  return [...state.blocks]
    .sort((a, b) => a.index - b.index)
    .map((b) =>
      b.kind === 'redacted_thinking'
        ? { type: 'redacted_thinking', data: b.data }
        : { type: 'thinking', thinking: b.thinking, signature: b.signature },
    );
}

// ── Redaction guarantee (persistence paths) ──────────────────────────────

const THINKING_BLOCK_TYPES = new Set(['thinking', 'redacted_thinking']);

/** Strip thinking blocks from a content-block array before persistence. */
export function stripThinkingBlocks<T extends { type?: unknown }>(blocks: T[]): T[] {
  return blocks.filter((b) => !THINKING_BLOCK_TYPES.has(String(b?.type ?? '')));
}

/** True when a content-block array still carries thinking material. */
export function containsThinkingBlocks(blocks: Array<{ type?: unknown }>): boolean {
  return blocks.some((b) => THINKING_BLOCK_TYPES.has(String(b?.type ?? '')));
}
