/**
 * Pure normalizer for Clio message feedback (P1-2).
 *
 * Thumbs up/down + an optional note are captured on assistant messages and
 * stored in clio_message.metadata.feedback (no schema change). This validates +
 * clamps the raw request body; the persistence lives in the service. Pure so it
 * unit-tests under `src/**.spec.ts`.
 */

export type FeedbackRating = 'up' | 'down' | null;

export interface NormalizedFeedback {
  rating: FeedbackRating;
  note: string | null;
}

const MAX_NOTE = 2000;

export function normalizeFeedback(input: { rating?: unknown; note?: unknown }): NormalizedFeedback {
  const rating: FeedbackRating =
    input.rating === 'up' ? 'up' : input.rating === 'down' ? 'down' : null;
  let note: string | null = null;
  if (typeof input.note === 'string') {
    const trimmed = input.note.trim();
    note = trimmed ? trimmed.slice(0, MAX_NOTE) : null;
  }
  return { rating, note };
}
