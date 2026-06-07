-- Layer 1: named-prime contractor linkage from RDT&E J-book R-3 "Product Development"
-- exhibits (program_element_performer), plus the USAspending File C TAS+ProgramActivity
-- funding crosswalk columns on federal_award (Layer 2/3). Both are global reference data
-- (no tenant_id / RLS), matching program_element + federal_award.

-- ── program_element_performer ───────────────────────────────────────────────
CREATE TABLE "program_element_performer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pe_code" VARCHAR(16) NOT NULL,
    "performer" TEXT NOT NULL,
    "performer_normalized" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "contract_method" TEXT NOT NULL DEFAULT '',
    "cost_category" TEXT NOT NULL DEFAULT '',
    "total_cost_m" DECIMAL(18,3),
    "table_type" TEXT,
    "project_code" TEXT,
    "project_name" TEXT,
    "fy" INTEGER NOT NULL,
    "source_url" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "publisher" TEXT,
    "is_named_company" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'comptroller_jbook_r3',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.95,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "program_element_performer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_element_performer_natural_key"
    ON "program_element_performer" ("pe_code", "performer_normalized", "location", "contract_method", "cost_category", "fy");
CREATE INDEX "program_element_performer_pe_code_idx" ON "program_element_performer" ("pe_code");
CREATE INDEX "program_element_performer_norm_idx" ON "program_element_performer" ("performer_normalized");
CREATE INDEX "program_element_performer_named_idx" ON "program_element_performer" ("is_named_company");

-- FK to program_element (R-3 enriches known PEs only; ON DELETE CASCADE mirrors the
-- other program_element_* child tables).
ALTER TABLE "program_element_performer"
    ADD CONSTRAINT "program_element_performer_pe_code_fkey"
    FOREIGN KEY ("pe_code") REFERENCES "program_element"("pe_code") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── federal_award: USAspending File C funding crosswalk (TAS + Program Activity) ──
ALTER TABLE "federal_award"
    ADD COLUMN "funding_tas" TEXT,
    ADD COLUMN "funding_tas_title" TEXT,
    ADD COLUMN "program_activity_code" TEXT,
    ADD COLUMN "program_activity_name" TEXT,
    ADD COLUMN "funding_fy" INTEGER,
    ADD COLUMN "pe_code_confidence" DOUBLE PRECISION,
    ADD COLUMN "pe_code_candidate_count" INTEGER,
    ADD COLUMN "matched_performer_id" UUID;

CREATE INDEX "federal_award_funding_tas_idx" ON "federal_award" ("funding_tas");
CREATE INDEX "federal_award_program_activity_idx" ON "federal_award" ("program_activity_code");
