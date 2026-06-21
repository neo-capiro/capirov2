import { describe, expect, test } from '@jest/globals';
import {
  buildCompactionPrompt,
  clampTurnForSummary,
  estimateTokens,
  formatSummaryBlockForPrompt,
  planCompaction,
  sanitizeSummaryOutput,
} from './meri-compaction.helpers.js';

const msg = (id: string, role: string, chars: number) => ({
  id,
  role,
  body: 'x'.repeat(chars),
});

describe('estimateTokens', () => {
  test('chars/4, rounded up, 0 for empty', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('planCompaction', () => {
  const base = { existingSummary: null, triggerTokens: 1000, tailMessages: 12 };

  test('does nothing while the conversation is short', () => {
    const plan = planCompaction({
      ...base,
      messages: Array.from({ length: 10 }, (_, i) => msg(`m${i}`, 'user', 4000)),
    });
    expect(plan.compact).toBe(false);
    expect(plan.toSummarize).toHaveLength(0);
  });

  test('does nothing while text beyond the tail is under the trigger', () => {
    // 16 messages, 4 beyond the tail, each tiny (25 tokens) => 100 tokens < 1000.
    const plan = planCompaction({
      ...base,
      messages: Array.from({ length: 16 }, (_, i) => msg(`m${i}`, 'user', 100)),
    });
    expect(plan.compact).toBe(false);
  });

  test('compacts the oldest messages once beyond-tail text reaches the trigger', () => {
    // 18 messages, 6 beyond the tail at 1000 chars (250 tokens) each = 1500 tokens.
    const messages = Array.from({ length: 18 }, (_, i) =>
      msg(`m${i}`, i % 2 ? 'assistant' : 'user', 1000),
    );
    const plan = planCompaction({ ...base, messages });
    expect(plan.compact).toBe(true);
    expect(plan.toSummarize.map((m) => m.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
    expect(plan.upToMessageId).toBe('m5');
  });

  test('respects minMessagesToSummarize even when tokens are huge', () => {
    const messages = Array.from({ length: 14 }, (_, i) => msg(`m${i}`, 'user', 50_000));
    const plan = planCompaction({ ...base, messages, minMessagesToSummarize: 4 });
    // 2 beyond the tail < 4 minimum.
    expect(plan.compact).toBe(false);
  });

  test('call frequency: a 300-message conversation triggers bounded compactions', () => {
    // Simulate the after-turn job across a 300-message conversation with
    // ~150-token turns. Each compaction folds everything beyond the tail, so
    // the number of small-model calls stays well under 1 per 15 turns.
    const turnChars = 600; // 150 tokens
    let boundary = 0;
    let calls = 0;
    for (let count = 1; count <= 300; count += 1) {
      const since = Array.from({ length: count - boundary }, (_, i) =>
        msg(`m${boundary + i}`, i % 2 ? 'assistant' : 'user', turnChars),
      );
      const plan = planCompaction({
        messages: since,
        existingSummary: boundary > 0 ? 'summary' : null,
        // The production default (config.schema.ts) — the frequency criterion
        // is tied to it, so keep them in sync.
        triggerTokens: 5000,
        tailMessages: 12,
      });
      if (plan.compact) {
        calls += 1;
        boundary += plan.toSummarize.length;
      }
    }
    expect(calls).toBeGreaterThan(0);
    // 300 messages = 150 user turns; <= 1 call per ~15 turns means <= 10 calls.
    expect(calls).toBeLessThanOrEqual(10);
  });
});

describe('buildCompactionPrompt', () => {
  test('includes the old summary and the new turns, labeled by speaker', () => {
    const prompt = buildCompactionPrompt({
      existingSummary: 'Facts & context: client is Acme Defense.',
      turns: [
        { role: 'user', body: 'What is the status of HR 2670?' },
        { role: 'assistant', body: 'HR 2670 passed the House on July 14 [2].' },
      ],
    });
    expect(prompt.user).toContain('Acme Defense');
    expect(prompt.user).toContain('User: What is the status of HR 2670?');
    expect(prompt.user).toContain('Meri: HR 2670 passed the House on July 14 [2].');
    expect(prompt.system).toContain('Preserve concrete identifiers');
    expect(prompt.system).toContain('400 words');
  });

  test('first compaction works without an existing summary', () => {
    const prompt = buildCompactionPrompt({
      existingSummary: null,
      turns: [{ role: 'user', body: 'hello' }],
    });
    expect(prompt.user).toContain('(none yet)');
  });

  test('structural guarantee: only the provided turn bodies enter the prompt', () => {
    // Encrypted meeting notes can never leak into a summary because the
    // prompt builder has no input other than the message turns handed to it.
    const prompt = buildCompactionPrompt({
      existingSummary: null,
      turns: [{ role: 'user', body: 'only this text' }],
    });
    const corpus = prompt.system + prompt.user;
    expect(corpus).toContain('only this text');
    expect(corpus).not.toContain('meeting');
  });

  test('clamps giant pasted turns', () => {
    const prompt = buildCompactionPrompt({
      existingSummary: null,
      turns: [{ role: 'user', body: 'y'.repeat(10_000) }],
    });
    expect(prompt.user.length).toBeLessThan(4000);
  });
});

describe('clampTurnForSummary', () => {
  test('clamps with ellipsis', () => {
    expect(clampTurnForSummary('z'.repeat(3000), 100).length).toBeLessThanOrEqual(101);
    expect(clampTurnForSummary('short')).toBe('short');
  });
});

describe('formatSummaryBlockForPrompt', () => {
  test('labels the block as established context', () => {
    const block = formatSummaryBlockForPrompt('Facts & context: …');
    expect(block).toContain('Conversation summary');
    expect(block).toContain('established conversation context');
  });
});

describe('sanitizeSummaryOutput', () => {
  test('null for empty, clamps oversized', () => {
    expect(sanitizeSummaryOutput('   ')).toBeNull();
    expect(sanitizeSummaryOutput('ok')).toBe('ok');
    expect(sanitizeSummaryOutput('a'.repeat(10_000))?.length).toBeLessThanOrEqual(6001);
  });
});
