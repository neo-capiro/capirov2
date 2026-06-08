/**
 * Step 3.4 — relationship-coverage STRENGTH banding (pure; no DB / no NestJS).
 *
 * Given the most-recent date the firm touched a person (across meetings, outreach
 * records, and mail threads) and the current time, returns a coarse coverage band the
 * UI renders as a colour. The bands are intentionally coarse — this is a "do we have a
 * warm relationship here?" signal, not an analytics metric.
 *
 *   - never touched (lastTouch null)        -> 'none'
 *   - touched < 30 days ago                  -> 'active'
 *   - touched < 120 days ago                 -> 'warm'
 *   - touched >= 120 days ago                -> 'cold'
 *
 * A FUTURE lastTouch (clock skew / a scheduled-but-not-yet-held meeting that recorded a
 * future startsAt) yields a NEGATIVE age, which is `< ACTIVE_MAX_DAYS` and so bands as
 * 'active' — the most generous band, which is the safe choice (we definitely have an
 * imminent touch).
 */

/** Coverage band for a single relationship. */
export type CoverageStrength = 'active' | 'warm' | 'cold' | 'none';

/** A touch newer than this many days is 'active'. Boundary is EXCLUSIVE (30d -> warm). */
export const ACTIVE_MAX_DAYS = 30;

/** A touch newer than this many days (but >= ACTIVE_MAX_DAYS) is 'warm'. Boundary EXCLUSIVE. */
export const WARM_MAX_DAYS = 120;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Band a last-touch date relative to `now`.
 *
 * `lastTouch` may be a Date, an ISO string, or null. A null (or an unparseable string)
 * means "we have never recorded contact" -> 'none'. Otherwise the age in WHOLE-ish days
 * (fractional, not floored) is compared against the two exclusive thresholds so the
 * boundary day lands in the WIDER band (exactly 30.0 days -> 'warm', exactly 120.0 ->
 * 'cold').
 */
export function coverageStrength(lastTouch: Date | string | null, now: Date): CoverageStrength {
  if (lastTouch === null || lastTouch === undefined) return 'none';

  const touchMs =
    lastTouch instanceof Date ? lastTouch.getTime() : new Date(lastTouch).getTime();
  if (Number.isNaN(touchMs)) return 'none';

  const ageDays = (now.getTime() - touchMs) / MS_PER_DAY;
  if (ageDays < ACTIVE_MAX_DAYS) return 'active';
  if (ageDays < WARM_MAX_DAYS) return 'warm';
  return 'cold';
}
