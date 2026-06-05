-- Soft-supersede / soft-retire markers for retiring stale old-DoW-directory data.
--
-- The original PE + acquisition-personnel load came from a spreadsheet generated
-- from an OLD DoW directory; it was later re-done "the right way" (Rev 6 DoW
-- directory for personnel, J-books for PEs). But the pipeline is additive-only and
-- no read filters by source, so the old rows still display. These columns let a
-- reconcile job flag superseded/retired rows WITHOUT a hard delete (watches /
-- federal_award / congress_bill reference pe_code with no FK; acquisition_personnel
-- carries CRM links + merge history) and let reads exclude them by default.
--
-- Additive + idempotent. Both tables stay global (no tenant_id / RLS). No backfill
-- here — the reconcile-personnel-supersede / reconcile-stale-pes tasks populate
-- these columns, dry-run first.

ALTER TABLE "acquisition_personnel" ADD COLUMN IF NOT EXISTS "superseded_at" TIMESTAMPTZ(6);
ALTER TABLE "acquisition_personnel" ADD COLUMN IF NOT EXISTS "superseded_reason" TEXT;

CREATE INDEX IF NOT EXISTS "acquisition_personnel_superseded_at_idx"
    ON "acquisition_personnel" ("superseded_at");

ALTER TABLE "program_element" ADD COLUMN IF NOT EXISTS "retired_at" TIMESTAMPTZ(6);
ALTER TABLE "program_element" ADD COLUMN IF NOT EXISTS "retired_reason" TEXT;

CREATE INDEX IF NOT EXISTS "program_element_retired_at_idx"
    ON "program_element" ("retired_at");
