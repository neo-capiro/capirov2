import { describe, expect, test } from '@jest/globals';
import {
  deriveMatchStatus,
  isOfficialExactTier,
  isWeakSignal,
  confidenceBand,
  OFFICIAL_EXACT_TIERS,
  type MatchStatus,
} from './program-match-thresholds.js';

describe('isOfficialExactTier', () => {
  test('official+exact tiers are recognized', () => {
    for (const t of Array.from(OFFICIAL_EXACT_TIERS)) {
      expect(isOfficialExactTier(t)).toBe(true);
    }
  });
  test('fuzzy / usage tiers are NOT official+exact', () => {
    for (const t of ['sam_match', 'award_match', 'press_release', 'news_only', 'other_funding_link', 'sar_msar']) {
      expect(isOfficialExactTier(t)).toBe(false);
    }
  });
  test('the curated seed tier is handled separately, not via OFFICIAL_EXACT_TIERS', () => {
    expect(isOfficialExactTier('mdap_curated')).toBe(false);
  });
});

describe('deriveMatchStatus — table-driven (plan §7 thresholds)', () => {
  // [score, evidenceTier, expectedStatus, why]
  const cases: Array<[number, string, MatchStatus, string]> = [
    // ── >=0.90 + official+exact -> accepted (the ONLY auto-accept paths) ──
    [1.0, 'exact_pe_number', 'accepted', 'exact PE number at full score'],
    [0.95, 'exact_project_title', 'accepted', 'exact project title >=0.90'],
    [0.9, 'r2a_office_named', 'accepted', 'boundary: 0.90 exact tier accepts'],
    [0.92, 'official_office_page', 'accepted', 'official office page >=0.90'],
    [1.0, 'mdap_curated', 'accepted', 'curated seed always accepts at full score'],
    // ── >=0.90 but NOT official+exact -> candidate (NEVER auto-accepted from fuzzy) ──
    [0.99, 'sam_match', 'candidate', 'high fuzzy score must still go to review'],
    [0.95, 'award_match', 'candidate', 'award usage never auto-accepts'],
    [0.91, 'other_funding_link', 'candidate', 'other-funding link is corroborating, not exact'],
    [0.9, 'news_only', 'candidate', 'boundary: 0.90 fuzzy tier is candidate'],
    // ── 0.70-0.89 -> candidate (regardless of tier) ──
    [0.89, 'exact_pe_number', 'candidate', 'just below accept floor -> candidate even on exact tier'],
    [0.7, 'sam_match', 'candidate', 'candidate floor (inclusive)'],
    [0.75, 'press_release', 'candidate', 'mid-band fuzzy candidate'],
    // ── 0.50-0.69 -> quarantined ──
    [0.69, 'exact_project_title', 'quarantined', 'just below candidate floor'],
    [0.5, 'sam_match', 'quarantined', 'quarantine floor (inclusive)'],
    [0.6, 'award_match', 'quarantined', 'mid quarantine band'],
    // ── <0.50 -> quarantined (weak signal) ──
    [0.49, 'exact_pe_number', 'quarantined', 'below quarantine floor still quarantined'],
    [0.1, 'news_only', 'quarantined', 'very weak signal quarantined'],
    [0.0, 'sam_match', 'quarantined', 'zero score quarantined'],
  ];

  for (const [score, tier, expected, why] of cases) {
    test(`score=${score} tier=${tier} -> ${expected} (${why})`, () => {
      expect(deriveMatchStatus(score, tier)).toBe(expected);
    });
  }

  test('INVARIANT: no fuzzy/usage tier can EVER derive accepted at any score', () => {
    const fuzzy = ['sam_match', 'award_match', 'press_release', 'news_only', 'other_funding_link', 'sar_msar'];
    for (let s = 0; s <= 1.0001; s += 0.05) {
      for (const tier of fuzzy) {
        expect(deriveMatchStatus(Math.min(s, 1), tier)).not.toBe('accepted');
      }
    }
  });
});

describe('isWeakSignal', () => {
  test('true strictly below 0.50', () => {
    expect(isWeakSignal(0.49)).toBe(true);
    expect(isWeakSignal(0)).toBe(true);
  });
  test('false at/above 0.50', () => {
    expect(isWeakSignal(0.5)).toBe(false);
    expect(isWeakSignal(0.9)).toBe(false);
  });
});

describe('confidenceBand', () => {
  test('maps score to band', () => {
    expect(confidenceBand(0.95)).toBe('high');
    expect(confidenceBand(0.9)).toBe('high');
    expect(confidenceBand(0.8)).toBe('medium');
    expect(confidenceBand(0.7)).toBe('medium');
    expect(confidenceBand(0.6)).toBe('low');
    expect(confidenceBand(0.5)).toBe('low');
    expect(confidenceBand(0.49)).toBe('weak');
  });
});
