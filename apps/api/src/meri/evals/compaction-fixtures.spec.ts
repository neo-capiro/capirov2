import { describe, expect, test } from '@jest/globals';
import {
  COMPACTION_CONVERSATION_LENGTH,
  COMPACTION_NEEDLES,
  generateCompactionConversation,
} from './compaction-fixtures.js';
import { planCompaction } from '../meri-compaction.helpers.js';

describe('compaction fixtures', () => {
  const conversation = generateCompactionConversation();

  test('produces the full 300-message conversation, alternating roles', () => {
    expect(conversation).toHaveLength(COMPACTION_CONVERSATION_LENGTH);
    expect(conversation[0]?.role).toBe('user');
    expect(conversation[1]?.role).toBe('assistant');
  });

  test('has 20 needle probes', () => {
    expect(COMPACTION_NEEDLES).toHaveLength(20);
    const ids = new Set(COMPACTION_NEEDLES.map((n) => n.id));
    expect(ids.size).toBe(20);
  });

  test('every needle is planted verbatim at its message index', () => {
    for (const needle of COMPACTION_NEEDLES) {
      expect(conversation[needle.messageIndex]?.body).toBe(needle.text);
    }
  });

  test('every needle answer lives in turns that compaction will fold away', () => {
    // All needles sit in the first 80 messages — far outside any 12-message
    // verbatim tail of a 300-message conversation, so a correct probe answer
    // can only come from the rolling summary.
    for (const needle of COMPACTION_NEEDLES) {
      expect(needle.messageIndex).toBeLessThan(80);
      expect(needle.messageIndex).toBeLessThan(COMPACTION_CONVERSATION_LENGTH - 12);
    }
  });

  test('needle mustInclude substrings appear in the planted text', () => {
    for (const needle of COMPACTION_NEEDLES) {
      for (const expected of needle.mustInclude) {
        expect(needle.text.toLowerCase()).toContain(expected.toLowerCase());
      }
    }
  });

  test('the conversation actually triggers compaction under production defaults', () => {
    const plan = planCompaction({
      messages: conversation.map((m) => ({ id: m.id, role: m.role, body: m.body })),
      existingSummary: null,
      triggerTokens: 5000,
      tailMessages: 12,
    });
    expect(plan.compact).toBe(true);
    expect(plan.toSummarize.length).toBeGreaterThan(0);
  });
});
