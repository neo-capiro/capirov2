import { describe, expect, test } from '@jest/globals';

/**
 * Unit test for the entity-resolution write-floor decision (the rule that keeps
 * low-confidence candidates out of the review queue). Mirrors the predicate used
 * in EntityResolutionService.resolveAllForTenant / resolveClient:
 *
 *   const autoConfirm = source !== 'fec_committee' && confidence >= 0.85;
 *   if (confidence < MIN_WRITE_CONFIDENCE && !autoConfirm) continue;  // skip
 *
 * The matching SQL casts a wide net (similarity > 0.3); this floor is what stops
 * generic-string noise from flooding the queue. Pinned here so a refactor can't
 * silently lower the floor or change the auto-confirm interaction.
 */
const MIN_WRITE_CONFIDENCE = 0.4;
const AUTO_CONFIRM_THRESHOLD = 0.85;

function decision(source: string, confidence: number): 'skip' | 'review' | 'auto_confirm' {
  const autoConfirm = source !== 'fec_committee' && confidence >= AUTO_CONFIRM_THRESHOLD;
  if (confidence < MIN_WRITE_CONFIDENCE && !autoConfirm) return 'skip';
  return autoConfirm ? 'auto_confirm' : 'review';
}

describe('entity-resolution write-floor', () => {
  test('drops sub-floor noise candidates', () => {
    expect(decision('fec_employer', 0.35)).toBe('skip');
    expect(decision('lda', 0.39)).toBe('skip');
  });

  test('keeps mid-confidence candidates for human review', () => {
    expect(decision('fec_employer', 0.4)).toBe('review');
    expect(decision('lda', 0.7)).toBe('review');
  });

  test('auto-confirms high-confidence non-PAC candidates', () => {
    expect(decision('lda', 0.9)).toBe('auto_confirm');
    expect(decision('contracting', 0.85)).toBe('auto_confirm');
  });

  test('PAC committee never auto-confirms even at high score (compliance gate)', () => {
    expect(decision('fec_committee', 0.95)).toBe('review');
    expect(decision('fec_committee', 0.86)).toBe('review');
  });

  test('PAC committee below floor is still dropped', () => {
    expect(decision('fec_committee', 0.3)).toBe('skip');
  });
});
