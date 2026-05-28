-- Migration: add_program_element
-- Purpose:
--   1) Add Program Element global tables:
--      - program_element
--      - program_element_year
--      - program_element_milestone
--   2) Extend congress_bill with pe_codes (TEXT[]) + GIN index
--   3) Extend intelligence_change with related_pe_codes (TEXT[]) + GIN index
-- Notes:
--   - Additive only (no DROP statements)
--   - Global intel tables (no tenant_id)
--   - Made fully idempotent (IF NOT EXISTS + DO blocks) because the
--     tables were partially created by a `prisma db push` against this
--     DB before the migration file was committed. Re-running the
--     migration on a clean DB still produces the same end state.

-- CreateTable
CREATE TABLE IF NOT EXISTS "program_element" (
    "pe_code" VARCHAR(8) NOT NULL,
    "service" TEXT,
    "service_code" TEXT,
    "appropriation_type" TEXT,
    "budget_activity" TEXT,
    "budget_activity_name" TEXT,
    "line_number" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acat_level" TEXT,
    "program_of_record" TEXT,
    "status" TEXT,
    "r_doc_url" TEXT,
    "p_doc_url" TEXT,
    "o_doc_url" TEXT,
    "raw_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "source" TEXT NOT NULL,
    "source_confidence" DOUBLE PRECISION,
    "first_seen_fy" INTEGER,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_element_pkey" PRIMARY KEY ("pe_code")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "program_element_year" (
    "id" UUID NOT NULL,
    "pe_code" VARCHAR(8) NOT NULL,
    "fy" INTEGER NOT NULL,
    "request" DECIMAL(14,2),
    "hasc_mark" DECIMAL(14,2),
    "sasc_mark" DECIMAL(14,2),
    "hac_d_mark" DECIMAL(14,2),
    "sac_d_mark" DECIMAL(14,2),
    "conference" DECIMAL(14,2),
    "enacted" DECIMAL(14,2),
    "reprogrammed" DECIMAL(14,2),
    "executed" DECIMAL(14,2),
    "notes" TEXT,
    "r_doc_section" TEXT,
    "raw_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_element_year_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "program_element_milestone" (
    "id" UUID NOT NULL,
    "pe_code" VARCHAR(8) NOT NULL,
    "milestone_type" TEXT NOT NULL,
    "planned_date" DATE,
    "actual_date" DATE,
    "status" TEXT,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_element_milestone_pkey" PRIMARY KEY ("id")
);

-- AlterTable (idempotent column adds)
ALTER TABLE "congress_bill"
ADD COLUMN IF NOT EXISTS "pe_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "intelligence_change"
ADD COLUMN IF NOT EXISTS "related_pe_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill columns on program_element if it was partially created by an
-- earlier `prisma db push` against an older schema. Each ADD COLUMN IF
-- NOT EXISTS is a no-op when the column is already present, so it's
-- safe to run on a clean DB (where CREATE TABLE just made all of them)
-- as well as on a DB with the older table shape.
ALTER TABLE "program_element"
  ADD COLUMN IF NOT EXISTS "service" TEXT,
  ADD COLUMN IF NOT EXISTS "service_code" TEXT,
  ADD COLUMN IF NOT EXISTS "appropriation_type" TEXT,
  ADD COLUMN IF NOT EXISTS "budget_activity" TEXT,
  ADD COLUMN IF NOT EXISTS "budget_activity_name" TEXT,
  ADD COLUMN IF NOT EXISTS "line_number" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "acat_level" TEXT,
  ADD COLUMN IF NOT EXISTS "program_of_record" TEXT,
  ADD COLUMN IF NOT EXISTS "status" TEXT,
  ADD COLUMN IF NOT EXISTS "r_doc_url" TEXT,
  ADD COLUMN IF NOT EXISTS "p_doc_url" TEXT,
  ADD COLUMN IF NOT EXISTS "o_doc_url" TEXT,
  ADD COLUMN IF NOT EXISTS "raw_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "source" TEXT,
  ADD COLUMN IF NOT EXISTS "source_confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "first_seen_fy" INTEGER,
  ADD COLUMN IF NOT EXISTS "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The CREATE TABLE above declares `source` as NOT NULL, but a fresh
-- ADD COLUMN against an existing populated table can't enforce NOT NULL
-- without a default. Tighten it in a separate step that's safe to skip
-- when the column was just created with the constraint (idempotent).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'program_element' AND column_name = 'source' AND is_nullable = 'YES'
  ) THEN
    -- Set a placeholder for any pre-existing rows so we can enforce NOT NULL.
    UPDATE "program_element" SET "source" = 'unknown' WHERE "source" IS NULL;
    ALTER TABLE "program_element" ALTER COLUMN "source" SET NOT NULL;
  END IF;
END
$$;

-- Backfill the FK + indexed columns on program_element_year. pe_code +
-- fy are NOT NULL in the schema but ADD COLUMN against a populated
-- table can't enforce NOT NULL without a default — we set NOT NULL in
-- a DO block below, gated on "currently nullable".
ALTER TABLE "program_element_year"
  ADD COLUMN IF NOT EXISTS "pe_code" VARCHAR(8),
  ADD COLUMN IF NOT EXISTS "fy" INTEGER,
  ADD COLUMN IF NOT EXISTS "request" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "hasc_mark" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "sasc_mark" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "hac_d_mark" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "sac_d_mark" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "conference" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "enacted" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "reprogrammed" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "executed" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "r_doc_section" TEXT,
  ADD COLUMN IF NOT EXISTS "raw_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "program_element_milestone"
  ADD COLUMN IF NOT EXISTS "pe_code" VARCHAR(8),
  ADD COLUMN IF NOT EXISTS "milestone_type" TEXT,
  ADD COLUMN IF NOT EXISTS "planned_date" DATE,
  ADD COLUMN IF NOT EXISTS "actual_date" DATE,
  ADD COLUMN IF NOT EXISTS "status" TEXT,
  ADD COLUMN IF NOT EXISTS "source" TEXT,
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'program_element_milestone' AND column_name = 'source' AND is_nullable = 'YES'
  ) THEN
    UPDATE "program_element_milestone" SET "source" = 'unknown' WHERE "source" IS NULL;
    ALTER TABLE "program_element_milestone" ALTER COLUMN "source" SET NOT NULL;
  END IF;
END
$$;

-- Tighten the FK + key columns to NOT NULL on previously-stale tables.
-- These columns were added nullable (above) so existing rows are
-- compatible; on a clean DB CREATE TABLE made them NOT NULL already
-- and the DO blocks skip via the is_nullable check.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'program_element_year' AND column_name = 'pe_code' AND is_nullable = 'YES'
  ) THEN
    DELETE FROM "program_element_year" WHERE "pe_code" IS NULL;
    ALTER TABLE "program_element_year" ALTER COLUMN "pe_code" SET NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'program_element_year' AND column_name = 'fy' AND is_nullable = 'YES'
  ) THEN
    DELETE FROM "program_element_year" WHERE "fy" IS NULL;
    ALTER TABLE "program_element_year" ALTER COLUMN "fy" SET NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'program_element_milestone' AND column_name = 'pe_code' AND is_nullable = 'YES'
  ) THEN
    DELETE FROM "program_element_milestone" WHERE "pe_code" IS NULL;
    ALTER TABLE "program_element_milestone" ALTER COLUMN "pe_code" SET NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'program_element_milestone' AND column_name = 'milestone_type' AND is_nullable = 'YES'
  ) THEN
    DELETE FROM "program_element_milestone" WHERE "milestone_type" IS NULL;
    ALTER TABLE "program_element_milestone" ALTER COLUMN "milestone_type" SET NOT NULL;
  END IF;
END
$$;

-- Indexes (all IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS "program_element_service_code_idx" ON "program_element"("service_code");
CREATE INDEX IF NOT EXISTS "program_element_appropriation_type_idx" ON "program_element"("appropriation_type");
CREATE INDEX IF NOT EXISTS "program_element_status_idx" ON "program_element"("status");
CREATE INDEX IF NOT EXISTS "program_element_year_fy_idx" ON "program_element_year"("fy");
CREATE UNIQUE INDEX IF NOT EXISTS "program_element_year_pe_code_fy_key" ON "program_element_year"("pe_code", "fy");
CREATE INDEX IF NOT EXISTS "program_element_milestone_status_idx" ON "program_element_milestone"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "program_element_milestone_pe_code_type_key" ON "program_element_milestone"("pe_code", "milestone_type");
CREATE INDEX IF NOT EXISTS "congress_bill_pe_codes_gin_idx" ON "congress_bill" USING GIN ("pe_codes");
CREATE INDEX IF NOT EXISTS "intelligence_change_pe_codes_gin_idx" ON "intelligence_change" USING GIN ("related_pe_codes");

-- Foreign keys (Postgres has no IF NOT EXISTS on ADD CONSTRAINT; wrap in
-- DO blocks that check pg_constraint first and skip if already there).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'program_element_year_pe_code_fkey'
    ) THEN
        ALTER TABLE "program_element_year"
        ADD CONSTRAINT "program_element_year_pe_code_fkey"
        FOREIGN KEY ("pe_code") REFERENCES "program_element"("pe_code")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'program_element_milestone_pe_code_fkey'
    ) THEN
        ALTER TABLE "program_element_milestone"
        ADD CONSTRAINT "program_element_milestone_pe_code_fkey"
        FOREIGN KEY ("pe_code") REFERENCES "program_element"("pe_code")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;
