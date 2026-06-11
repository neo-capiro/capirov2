import { describe, expect, test } from '@jest/globals';
import {
  applyThinkingStreamEvent,
  containsThinkingBlocks,
  createThinkingState,
  stripThinkingBlocks,
  thinkingReplayBlocks,
  thinkingRequestParams,
} from './clio-thinking.helpers.js';

const ON = { enabled: true, mode: 'adaptive' as const, budgetTokens: 8000 };

describe('thinkingRequestParams', () => {
  test('fast tier is byte-identical to baseline (no thinking, base max_tokens)', () => {
    expect(thinkingRequestParams(ON, 'fast', 4000)).toEqual({ thinking: null, maxTokens: 4000 });
  });
  test('kill-switch restores baseline on the deep tier too', () => {
    expect(thinkingRequestParams({ ...ON, enabled: false }, 'deep', 4000)).toEqual({
      thinking: null,
      maxTokens: 4000,
    });
  });
  test('adaptive mode requests adaptive thinking with answer headroom', () => {
    const params = thinkingRequestParams(ON, 'deep', 4000);
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(params.maxTokens).toBe(12_000);
  });
  test('budget mode sends budget_tokens strictly below max_tokens', () => {
    const params = thinkingRequestParams({ ...ON, mode: 'budget' }, 'deep', 4000);
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 });
    expect(params.maxTokens).toBe(12_000);
    expect((params.thinking as { budget_tokens: number }).budget_tokens).toBeLessThan(
      params.maxTokens,
    );
  });
  test('budget mode enforces the API minimum budget of 1024', () => {
    const params = thinkingRequestParams({ ...ON, mode: 'budget', budgetTokens: 10 }, 'deep', 4000);
    expect((params.thinking as { budget_tokens: number }).budget_tokens).toBe(1024);
  });
});

describe('thinking stream accumulation', () => {
  test('accumulates thinking deltas and signatures per block', () => {
    const state = createThinkingState();
    applyThinkingStreamEvent(state, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking' },
    });
    const d1 = applyThinkingStreamEvent(state, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Considering the bill ' },
    });
    const d2 = applyThinkingStreamEvent(state, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'history first.' },
    });
    applyThinkingStreamEvent(state, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 'sig123' },
    });
    expect(d1.thinkingTextDelta).toBe('Considering the bill ');
    expect(d2.thinkingTextDelta).toBe('history first.');
    expect(state.blocks).toHaveLength(1);
    expect(state.blocks[0]?.thinking).toBe('Considering the bill history first.');
    expect(state.blocks[0]?.signature).toBe('sig123');
  });

  test('redacted_thinking captures opaque data and emits no UI text', () => {
    const state = createThinkingState();
    applyThinkingStreamEvent(state, {
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'redacted_thinking', data: 'opaque' },
    });
    expect(state.blocks[0]).toMatchObject({ kind: 'redacted_thinking', data: 'opaque' });
  });

  test('non-thinking events are ignored', () => {
    const state = createThinkingState();
    applyThinkingStreamEvent(state, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text' },
    });
    applyThinkingStreamEvent(state, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'visible' },
    });
    expect(state.blocks).toHaveLength(0);
  });

  test('replay blocks come back in stream order with signatures intact', () => {
    const state = createThinkingState();
    applyThinkingStreamEvent(state, {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'redacted_thinking', data: 'zz' },
    });
    applyThinkingStreamEvent(state, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking' },
    });
    applyThinkingStreamEvent(state, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'plan' },
    });
    applyThinkingStreamEvent(state, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'signature_delta', signature: 's' },
    });
    expect(thinkingReplayBlocks(state)).toEqual([
      { type: 'thinking', thinking: 'plan', signature: 's' },
      { type: 'redacted_thinking', data: 'zz' },
    ]);
  });
});

describe('redaction guarantee (F3): thinking never persists', () => {
  const mixed = [
    { type: 'thinking', thinking: 'secret reasoning', signature: 's' },
    { type: 'redacted_thinking', data: 'opaque' },
    { type: 'text', text: 'visible answer' },
    { type: 'tool_use', id: 't1', name: 'search_congress_bills', input: {} },
  ];

  test('stripThinkingBlocks removes every thinking variant and nothing else', () => {
    const stripped = stripThinkingBlocks(mixed);
    expect(stripped).toEqual([
      { type: 'text', text: 'visible answer' },
      { type: 'tool_use', id: 't1', name: 'search_congress_bills', input: {} },
    ]);
    expect(containsThinkingBlocks(stripped)).toBe(false);
    expect(JSON.stringify(stripped)).not.toContain('secret reasoning');
    expect(JSON.stringify(stripped)).not.toContain('opaque');
  });

  test('containsThinkingBlocks detects leaks', () => {
    expect(containsThinkingBlocks(mixed)).toBe(true);
    expect(containsThinkingBlocks([{ type: 'text' }])).toBe(false);
  });
});
