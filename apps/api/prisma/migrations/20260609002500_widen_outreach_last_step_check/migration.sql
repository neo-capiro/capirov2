-- Widen the outreach_records.last_step CHECK constraint from 1..5 to 1..7.
--
-- The original migration (20260505203000_engagement_outreach_records) created
-- CHECK (last_step >= 1 AND last_step <= 5) when the outreach wizard had 5 steps.
-- The v2 wizard now has 7 steps (Direction, Campaign Setup, Recipients, Template,
-- Build Context, Generate & Review, Send) and the API DTO already accepts 1..7
-- (CreateOutreachRecordDto/UpdateOutreachRecordDto @Min(1) @Max(7), service
-- clampInt(..., 1, 7)). Saving a draft on step 6 or 7 therefore passed API
-- validation but violated the stale DB CHECK with Postgres 23514:
--   new row for relation "outreach_records" violates check constraint
--   "outreach_records_last_step_check"
-- => the save 500'd. This aligns the DB constraint with the API/DTO bound.
--
-- Safe + non-destructive: only widens an allowed range. All existing rows
-- (last_step values 1..5) remain valid; no row is rewritten.

ALTER TABLE "outreach_records"
  DROP CONSTRAINT IF EXISTS "outreach_records_last_step_check";

ALTER TABLE "outreach_records"
  ADD CONSTRAINT "outreach_records_last_step_check"
    CHECK ("last_step" >= 1 AND "last_step" <= 7);
