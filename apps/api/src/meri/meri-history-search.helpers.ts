/**
 * Pure helpers for conversation-history search (assistant-parity F2).
 *
 * Messages are embedded into context_embeddings (sourceType 'clio_message',
 * hash-skip via the shared embedder) on write; search runs pgvector cosine
 * first with a keyword ILIKE fallback (same degrade pattern as memory
 * recall). These helpers shape the hits: snippet extraction around the match
 * and per-conversation grouping (best hit wins).
 */

export interface HistorySearchHit {
  conversationId: string;
  messageId: string;
  title: string;
  clientId: string | null;
  body: string;
  createdAt: Date;
  /** Cosine similarity for semantic hits; null for keyword hits. */
  score: number | null;
}

export interface HistorySearchResult {
  conversationId: string;
  title: string;
  clientId: string | null;
  messageId: string;
  snippet: string;
  createdAt: Date;
  score: number | null;
}

/** Build a compact snippet centered on the first query-term match. */
export function buildSearchSnippet(body: string, query: string, radius = 90): string {
  const clean = body.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  let idx = -1;
  const lower = clean.toLowerCase();
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (idx < 0 || found < idx)) idx = found;
  }
  if (idx < 0) return clean.length > radius * 2 ? `${clean.slice(0, radius * 2).trimEnd()}…` : clean;
  const start = Math.max(0, idx - radius);
  const end = Math.min(clean.length, idx + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

/**
 * Group raw message hits by conversation, keeping each conversation's best
 * hit (highest score, then most recent), ordered by that best hit.
 */
export function groupHitsByConversation(
  hits: HistorySearchHit[],
  query: string,
  limit = 10,
): HistorySearchResult[] {
  const best = new Map<string, HistorySearchHit>();
  for (const hit of hits) {
    const current = best.get(hit.conversationId);
    if (!current) {
      best.set(hit.conversationId, hit);
      continue;
    }
    const better =
      (hit.score ?? -1) > (current.score ?? -1) ||
      ((hit.score ?? -1) === (current.score ?? -1) &&
        hit.createdAt.getTime() > current.createdAt.getTime());
    if (better) best.set(hit.conversationId, hit);
  }
  return [...best.values()]
    .sort((a, b) => {
      const scoreDiff = (b.score ?? -1) - (a.score ?? -1);
      if (scoreDiff !== 0) return scoreDiff;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, limit)
    .map((hit) => ({
      conversationId: hit.conversationId,
      title: hit.title,
      clientId: hit.clientId,
      messageId: hit.messageId,
      snippet: buildSearchSnippet(hit.body, query),
      createdAt: hit.createdAt,
      score: hit.score,
    }));
}

/** Text embedded for one message (kept identical between index + re-index). */
export function buildMessageEmbeddingText(input: {
  conversationTitle: string | null;
  role: string;
  body: string;
}): string {
  const parts = [
    input.conversationTitle ? `Conversation: ${input.conversationTitle}` : null,
    `${input.role === 'assistant' ? 'Meri' : 'User'}: ${input.body}`,
  ].filter(Boolean);
  return parts.join('\n');
}
