import {
  dedupeKey,
  GATE_MATERIALITY_MIN,
  GATE_RELEVANCE_MIN,
  shouldGenerate,
} from './action-gating.js';

describe('action-gating', () => {
  describe('shouldGenerate', () => {
    test('generates when both scores are at the threshold (inclusive)', () => {
      expect(
        shouldGenerate({
          materialityScore: GATE_MATERIALITY_MIN,
          relevanceScore: GATE_RELEVANCE_MIN,
        }),
      ).toBe(true);
    });

    test('generates when both scores comfortably clear the gates', () => {
      expect(shouldGenerate({ materialityScore: 0.9, relevanceScore: 0.8 })).toBe(true);
    });

    test('does NOT generate when materiality is just below the gate', () => {
      expect(
        shouldGenerate({
          materialityScore: GATE_MATERIALITY_MIN - 0.01,
          relevanceScore: 0.9,
        }),
      ).toBe(false);
    });

    test('does NOT generate when relevance is just below the gate', () => {
      expect(
        shouldGenerate({
          materialityScore: 0.9,
          relevanceScore: GATE_RELEVANCE_MIN - 0.01,
        }),
      ).toBe(false);
    });

    test('requires BOTH gates — one passing is not enough', () => {
      expect(shouldGenerate({ materialityScore: 1, relevanceScore: 0 })).toBe(false);
      expect(shouldGenerate({ materialityScore: 0, relevanceScore: 1 })).toBe(false);
    });
  });

  describe('dedupeKey', () => {
    test('is stable for the same inputs', () => {
      const a = dedupeKey({ clientId: 'c1', deltaId: 'd1', actionType: 'protect_funding' });
      const b = dedupeKey({ clientId: 'c1', deltaId: 'd1', actionType: 'protect_funding' });
      expect(a).toBe(b);
    });

    test('coalesces a missing/null delta to empty string (matches DB index)', () => {
      const undef = dedupeKey({ clientId: 'c1', actionType: 'client_alert' });
      const nul = dedupeKey({ clientId: 'c1', deltaId: null, actionType: 'client_alert' });
      const empty = dedupeKey({ clientId: 'c1', deltaId: '', actionType: 'client_alert' });
      expect(undef).toBe(nul);
      expect(undef).toBe(empty);
      expect(undef).toBe('c1||client_alert');
    });

    test('differs by client, delta, and action type', () => {
      const base = dedupeKey({ clientId: 'c1', deltaId: 'd1', actionType: 'protect_funding' });
      expect(base).not.toBe(
        dedupeKey({ clientId: 'c2', deltaId: 'd1', actionType: 'protect_funding' }),
      );
      expect(base).not.toBe(
        dedupeKey({ clientId: 'c1', deltaId: 'd2', actionType: 'protect_funding' }),
      );
      expect(base).not.toBe(
        dedupeKey({ clientId: 'c1', deltaId: 'd1', actionType: 'restore_cut' }),
      );
    });
  });
});
