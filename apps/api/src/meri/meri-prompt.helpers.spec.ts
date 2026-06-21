import {
  addUsage,
  applyRoundUsageEvent,
  applyToolCacheControl,
  buildMeriSystemBlocks,
  meriCapabilityBlock,
  CLIO_CAPABILITY_LINES,
  emptyUsage,
  readUsageFromStreamEvent,
} from './meri-prompt.helpers.js';

describe('meriCapabilityBlock (self-description correctness)', () => {
  it('states persistent memory, document generation, and table formatting', () => {
    const block = meriCapabilityBlock().toLowerCase();
    expect(block).toContain('persistent memory');
    expect(block).toContain('.docx');
    expect(block).toContain('.xlsx');
    expect(block).toContain('.pptx');
    expect(block).toContain('table');
  });
  it('affirms it IS a conversational AI (regression: must not deny chatting)', () => {
    const block = meriCapabilityBlock().toLowerCase();
    expect(block).toContain('conversational ai');
    expect(block).toContain('the answer is yes');
  });
  it('forbids the "just a chatbot / no memory" framing and warns against overstating', () => {
    const block = meriCapabilityBlock();
    expect(block).toContain('never claim you are "just a chatbot"');
    expect(block.toLowerCase()).toContain('only claim a capability you actually have');
  });
  it('advertises firm operational data + approval-gated task/workflow writes', () => {
    const block = meriCapabilityBlock().toLowerCase();
    expect(block).toContain("firm's own work");
    expect(block).toContain('workflows');
    expect(block).toContain('strategies');
    expect(block).toContain('needs-attention');
    expect(block).toContain('tracked bills');
    expect(block).toContain('regulatory dockets');
    expect(block).toContain('sam.gov');
    expect(block).toContain('client profiles');
    expect(block).toContain('debrief');
    expect(block).toContain('outreach');
    expect(block).toContain("with the user's approval");
  });
  it('joins the capability lines verbatim', () => {
    expect(meriCapabilityBlock()).toBe(CLIO_CAPABILITY_LINES.join('\n'));
  });
});

describe('buildMeriSystemBlocks', () => {
  it('puts a single cache breakpoint on the static base block when caching is enabled', () => {
    const blocks = buildMeriSystemBlocks({
      base: 'BASE PROMPT',
      dynamic: 'ctx',
      cacheEnabled: true,
    });
    expect(blocks).toEqual([
      { type: 'text', text: 'BASE PROMPT', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'ctx' },
    ]);
    // The dynamic block must never carry a breakpoint (it varies per turn).
    expect(blocks[1]!.cache_control).toBeUndefined();
  });

  it('omits all cache_control when caching is disabled', () => {
    const blocks = buildMeriSystemBlocks({ base: 'BASE', dynamic: 'ctx', cacheEnabled: false });
    expect(blocks.every((b) => b.cache_control === undefined)).toBe(true);
  });

  it('emits only the base block when the dynamic tail is empty or whitespace', () => {
    expect(buildMeriSystemBlocks({ base: 'BASE', dynamic: '', cacheEnabled: true })).toHaveLength(
      1,
    );
    expect(
      buildMeriSystemBlocks({ base: 'BASE', dynamic: '   \n ', cacheEnabled: true }),
    ).toHaveLength(1);
    expect(buildMeriSystemBlocks({ base: 'BASE', cacheEnabled: true })).toHaveLength(1);
  });

  it('preserves base text byte-for-byte so the cached prefix is stable across turns', () => {
    const base = 'You are Meri.\n- rule one\n- rule two';
    const a = buildMeriSystemBlocks({ base, dynamic: 'turn-1 context', cacheEnabled: true });
    const b = buildMeriSystemBlocks({
      base,
      dynamic: 'turn-2 different context',
      cacheEnabled: true,
    });
    expect(a[0]).toEqual(b[0]); // identical cached base block => cache hit
  });

  it('does not attach a breakpoint to an empty base', () => {
    const blocks = buildMeriSystemBlocks({ base: '', dynamic: 'ctx', cacheEnabled: true });
    expect(blocks[0]!.cache_control).toBeUndefined();
  });
});

describe('applyToolCacheControl', () => {
  const tools = [
    { name: 'a', description: 'A', input_schema: {} },
    { name: 'b', description: 'B', input_schema: {} },
    { name: 'c', description: 'C', input_schema: {} },
  ];

  it('marks only the last tool when caching is enabled', () => {
    const out = applyToolCacheControl(tools, true);
    expect(out[0]!.cache_control).toBeUndefined();
    expect(out[1]!.cache_control).toBeUndefined();
    expect(out[2]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('marks no tool when caching is disabled', () => {
    const out = applyToolCacheControl(tools, false);
    expect(out.every((t) => (t as { cache_control?: unknown }).cache_control === undefined)).toBe(
      true,
    );
  });

  it('never mutates the input array or its elements', () => {
    const input = [{ name: 'x', description: 'X', input_schema: {} }];
    const out = applyToolCacheControl(input, true);
    expect(out[0]).not.toBe(input[0]); // shallow clone
    expect((input[0] as { cache_control?: unknown }).cache_control).toBeUndefined();
  });

  it('handles an empty tool list', () => {
    expect(applyToolCacheControl([], true)).toEqual([]);
  });
});

describe('readUsageFromStreamEvent', () => {
  it('reads all four counts from message_start', () => {
    const evt = {
      type: 'message_start',
      message: {
        usage: {
          input_tokens: 1200,
          output_tokens: 1,
          cache_read_input_tokens: 800,
          cache_creation_input_tokens: 400,
        },
      },
    };
    expect(readUsageFromStreamEvent(evt)).toEqual({
      inputTokens: 1200,
      outputTokens: 1,
      cacheReadInputTokens: 800,
      cacheCreationInputTokens: 400,
    });
  });

  it('defaults missing cache fields on message_start to 0', () => {
    const evt = { type: 'message_start', message: { usage: { input_tokens: 50 } } };
    expect(readUsageFromStreamEvent(evt)).toEqual({
      inputTokens: 50,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
  });

  it('reads only output_tokens from message_delta', () => {
    expect(
      readUsageFromStreamEvent({ type: 'message_delta', usage: { output_tokens: 321 } }),
    ).toEqual({
      outputTokens: 321,
    });
  });

  it('returns null for events without usage and for garbage', () => {
    expect(
      readUsageFromStreamEvent({ type: 'content_block_delta', delta: { text: 'hi' } }),
    ).toBeNull();
    expect(readUsageFromStreamEvent({ type: 'message_delta' })).toBeNull();
    expect(readUsageFromStreamEvent({ type: 'message_start', message: {} })).toBeNull();
    expect(readUsageFromStreamEvent(null)).toBeNull();
    expect(readUsageFromStreamEvent('nope')).toBeNull();
  });
});

describe('addUsage', () => {
  it('folds a delta into the accumulator, treating missing fields as 0', () => {
    const acc = emptyUsage();
    addUsage(acc, { inputTokens: 10, cacheReadInputTokens: 5 });
    addUsage(acc, { outputTokens: 7, cacheCreationInputTokens: 3 });
    expect(acc).toEqual({
      inputTokens: 10,
      outputTokens: 7,
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 3,
    });
  });
});

describe('applyRoundUsageEvent', () => {
  it('accumulates a realistic round: message_start then several message_delta', () => {
    const round = emptyUsage();
    applyRoundUsageEvent(round, {
      type: 'message_start',
      message: {
        usage: {
          input_tokens: 30,
          output_tokens: 1,
          cache_read_input_tokens: 1500,
          cache_creation_input_tokens: 0,
        },
      },
    });
    applyRoundUsageEvent(round, { type: 'message_delta', usage: { output_tokens: 40 } });
    applyRoundUsageEvent(round, { type: 'message_delta', usage: { output_tokens: 95 } });
    // input/cache from message_start are retained; output is the latest cumulative delta.
    expect(round).toEqual({
      inputTokens: 30,
      outputTokens: 95,
      cacheReadInputTokens: 1500,
      cacheCreationInputTokens: 0,
    });
  });

  it('ignores events with no usage', () => {
    const round = emptyUsage();
    applyRoundUsageEvent(round, { type: 'ping' });
    applyRoundUsageEvent(round, { type: 'content_block_start', index: 0 });
    expect(round).toEqual(emptyUsage());
  });
});
