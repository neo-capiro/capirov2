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

-- CreateTable
CREATE TABLE "program_element" (
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
CREATE TABLE "program_element_year" (
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
CREATE TABLE "program_element_milestone" (
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

-- AlterTable
ALTER TABLE "congress_bill"
ADD COLUMN "pe_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "intelligence_change"
ADD COLUMN "related_pe_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "program_element_service_code_idx" ON "program_element"("service_code");

-- CreateIndex
CREATE INDEX "program_element_appropriation_type_idx" ON "program_element"("appropriation_type");

-- CreateIndex
CREATE INDEX "program_element_status_idx" ON "program_element"("status");

-- CreateIndex
CREATE INDEX "program_element_year_fy_idx" ON "program_element_year"("fy");

-- CreateIndex
CREATE UNIQUE INDEX "program_element_year_pe_code_fy_key" ON "program_element_year"("pe_code", "fy");

-- CreateIndex
CREATE INDEX "program_element_milestone_status_idx" ON "program_element_milestone"("status");

-- CreateIndex
CREATE UNIQUE INDEX "program_element_milestone_pe_code_type_key" ON "program_element_milestone"("pe_code", "milestone_type");

-- CreateIndex
CREATE INDEX "congress_bill_pe_codes_gin_idx" ON "congress_bill" USING GIN ("pe_codes");

-- CreateIndex
CREATE INDEX "intelligence_change_pe_codes_gin_idx" ON "intelligence_change" USING GIN ("related_pe_codes");

-- AddForeignKey
ALTER TABLE "program_element_year"
ADD CONSTRAINT "program_element_year_pe_code_fkey"
FOREIGN KEY ("pe_code") REFERENCES "program_element"("pe_code")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_element_milestone"
ADD CONSTRAINT "program_element_milestone_pe_code_fkey"
FOREIGN KEY ("pe_code") REFERENCES "program_element"("pe_code")
ON DELETE CASCADE ON UPDATE CASCADE;
