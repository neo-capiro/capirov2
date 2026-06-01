-- Phase 1 District Nexus: capture USAspending place-of-performance + recipient
-- location (state + congressional district) on federal_award so spend can be
-- aggregated by congressional district. Additive + idempotent; nullable columns,
-- no backfill here (sync-federal-award re-run populates existing rows). Global
-- table (no tenant_id, no RLS) — unchanged.
ALTER TABLE "federal_award" ADD COLUMN IF NOT EXISTS "pop_state" TEXT;
ALTER TABLE "federal_award" ADD COLUMN IF NOT EXISTS "pop_congressional_district" TEXT;
ALTER TABLE "federal_award" ADD COLUMN IF NOT EXISTS "recipient_state" TEXT;
ALTER TABLE "federal_award" ADD COLUMN IF NOT EXISTS "recipient_congressional_district" TEXT;

CREATE INDEX IF NOT EXISTS "federal_award_pop_district_idx"
    ON "federal_award" ("pop_state", "pop_congressional_district");
