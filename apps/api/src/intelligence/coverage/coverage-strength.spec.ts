import {
  ACTIVE_MAX_DAYS,
  WARM_MAX_DAYS,
  coverageStrength,
  type CoverageStrength,
} from './coverage-strength.js';

/**
 * Step 3.4 — coverage-strength banding boundaries. The thresholds are EXCLUSIVE on the
 * low side, so a touch at EXACTLY 30 days is 'warm' (not 'active') and EXACTLY 120 days
 * is 'cold' (not 'warm'). null/future inputs have explicit behaviour.
 */

const NOW = new Date('2026-06-08T12:00:00.000Z');

/** A Date exactly `days` before NOW. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe('coverageStrength', () => {
  test('null lastTouch -> none', () => {
    expect(coverageStrength(null, NOW)).toBe('none');
  });

  test('an unparseable string -> none', () => {
    expect(coverageStrength('not-a-date', NOW)).toBe('none');
  });

  test('a touch today -> active', () => {
    expect(coverageStrength(NOW, NOW)).toBe('active');
  });

  test('29 days ago -> active (just inside the active window)', () => {
    expect(coverageStrength(daysAgo(29), NOW)).toBe('active');
  });

  test('exactly 30 days ago -> warm (boundary is exclusive)', () => {
    expect(coverageStrength(daysAgo(ACTIVE_MAX_DAYS), NOW)).toBe('warm');
  });

  test('119 days ago -> warm (just inside the warm window)', () => {
    expect(coverageStrength(daysAgo(119), NOW)).toBe('warm');
  });

  test('exactly 120 days ago -> cold (boundary is exclusive)', () => {
    expect(coverageStrength(daysAgo(WARM_MAX_DAYS), NOW)).toBe('cold');
  });

  test('a year ago -> cold', () => {
    expect(coverageStrength(daysAgo(365), NOW)).toBe('cold');
  });

  test('a future touch (negative age) -> active (most generous band)', () => {
    expect(coverageStrength(daysAgo(-5), NOW)).toBe('active');
  });

  test('accepts an ISO string and bands it like a Date', () => {
    const iso = daysAgo(10).toISOString();
    const asDate = coverageStrength(daysAgo(10), NOW);
    expect(coverageStrength(iso, NOW)).toBe(asDate);
    expect(coverageStrength(iso, NOW)).toBe<CoverageStrength>('active');
  });
});
