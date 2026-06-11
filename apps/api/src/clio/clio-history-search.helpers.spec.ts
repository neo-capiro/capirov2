import { describe, expect, test } from '@jest/globals';
import {
  buildMessageEmbeddingText,
  buildSearchSnippet,
  groupHitsByConversation,
  type HistorySearchHit,
} from './clio-history-search.helpers.js';

const hit = (over: Partial<HistorySearchHit>): HistorySearchHit => ({
  conversationId: 'c1',
  messageId: 'm1',
  title: 'NDAA strategy',
  clientId: null,
  body: 'We discussed the NDAA markup schedule and amendment deadlines.',
  createdAt: new Date('2026-06-01T00:00:00Z'),
  score: 0.8,
  ...over,
});

describe('buildSearchSnippet', () => {
  test('centers the snippet on the first matching term', () => {
    const body = `${'a '.repeat(200)}the NDAA markup is Wednesday${' b'.repeat(200)}`;
    const snippet = buildSearchSnippet(body, 'ndaa markup');
    expect(snippet).toContain('NDAA markup');
    expect(snippet.length).toBeLessThan(220);
    expect(snippet.startsWith('…')).toBe(true);
  });
  test('falls back to the lead text when no term matches', () => {
    const snippet = buildSearchSnippet('z'.repeat(500), 'unrelated query');
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(182);
  });
  test('short bodies pass through', () => {
    expect(buildSearchSnippet('short note', 'note')).toBe('short note');
  });
});

describe('groupHitsByConversation', () => {
  test('keeps the best hit per conversation, ordered by score', () => {
    const results = groupHitsByConversation(
      [
        hit({ conversationId: 'c1', messageId: 'm1', score: 0.5 }),
        hit({ conversationId: 'c1', messageId: 'm2', score: 0.9 }),
        hit({ conversationId: 'c2', messageId: 'm3', score: 0.7, title: 'Approps' }),
      ],
      'ndaa',
    );
    expect(results.map((r) => r.conversationId)).toEqual(['c1', 'c2']);
    expect(results[0]?.messageId).toBe('m2');
  });

  test('keyword hits (null score) rank by recency among themselves', () => {
    const results = groupHitsByConversation(
      [
        hit({ conversationId: 'c1', score: null, createdAt: new Date('2026-01-01') }),
        hit({ conversationId: 'c2', score: null, createdAt: new Date('2026-06-01') }),
      ],
      'ndaa',
    );
    expect(results.map((r) => r.conversationId)).toEqual(['c2', 'c1']);
  });

  test('applies the limit after grouping', () => {
    const hits = Array.from({ length: 15 }, (_, i) =>
      hit({ conversationId: `c${i}`, score: i / 15 }),
    );
    expect(groupHitsByConversation(hits, 'q', 10)).toHaveLength(10);
  });
});

describe('buildMessageEmbeddingText', () => {
  test('prefixes the conversation title and speaker', () => {
    const text = buildMessageEmbeddingText({
      conversationTitle: 'FY27 approps',
      role: 'assistant',
      body: 'The subcommittee marks up Tuesday.',
    });
    expect(text).toBe('Conversation: FY27 approps\nClio: The subcommittee marks up Tuesday.');
  });
  test('omits a missing title', () => {
    expect(
      buildMessageEmbeddingText({ conversationTitle: null, role: 'user', body: 'hi' }),
    ).toBe('User: hi');
  });
});
