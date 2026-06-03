import {
  embeddingSimilarityFloor,
  TRACKED_BILL_SIMILARITY_FLOOR,
  THIN_SIGNAL_SIMILARITY_FLOOR,
} from './intelligence.service.js';

describe('embeddingSimilarityFloor (thin-signal guard)', () => {
  test('clients WITH capability signal keep the default (looser) floor', () => {
    expect(embeddingSimilarityFloor(true)).toBe(TRACKED_BILL_SIMILARITY_FLOOR);
    expect(embeddingSimilarityFloor(true)).toBe(0.65);
  });

  test('thin-signal clients (no capabilities) get the tighter floor', () => {
    expect(embeddingSimilarityFloor(false)).toBe(THIN_SIGNAL_SIMILARITY_FLOOR);
    expect(embeddingSimilarityFloor(false)).toBe(0.75);
  });

  test('the thin-signal floor is strictly tighter than the default', () => {
    // The guard only ever tightens matching for weak-signal clients; it must
    // never loosen it below the default that capability-bearing clients use.
    expect(THIN_SIGNAL_SIMILARITY_FLOOR).toBeGreaterThan(TRACKED_BILL_SIMILARITY_FLOOR);
  });
});
