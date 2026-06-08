-- Step 1.3 — Budget-cycle (PB position) dimension + FYDP outyears (plan §5/§6).
-- GLOBAL table (no tenant_id / RLS): public-domain budget data, same as
-- program_element / federal_award. Purely additive — ProgramElementYear (the
-- consolidated stage ladder the profile UI renders today) is untouched, and no
-- existing row is written or altered here.
--
-- One row per (pe_code, position_cycle, asserted_fy, value_kind):
--   position_cycle = the book/stage asserting the values ('pb_fy2026'|'pb_fy2027'|
--                    'hasc_fy2027'|'enacted_fy2026'|...).
--   asserted_fy    = the fiscal year the dollars/quantity are FOR (the FYDP column).
--   value_kind     = 'total' ($M) | 'quantity' (units) | 'unit_cost' ($M/unit).
-- This shape stores FY27 PB's FY27 request AND FY27 PB's FY28-31 outyears AND FY26
-- PB's FY27 projection at once — exactly what PB-vs-prior-PB + outyear deltas need.

CREATE TABLE "program_element_budget_position" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pe_code" VARCHAR(16) NOT NULL,
    "position_cycle" TEXT NOT NULL,
    "asserted_fy" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "quantity" DECIMAL(14,2),
    "value_kind" TEXT NOT NULL,
    "source_url" TEXT,
    "page_number" INTEGER,
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "source_document_id" UUID,
    CONSTRAINT "program_element_budget_position_pkey" PRIMARY KEY ("id")
);

-- Natural key: one value per (PE, cycle, asserted FY, value kind) — the loader
-- upserts on this so re-running a sync is idempotent.
CREATE UNIQUE INDEX "program_element_budget_position_natural_key" ON "program_element_budget_position" ("pe_code", "position_cycle", "asserted_fy", "value_kind");
CREATE INDEX "program_element_budget_position_pe_fy_idx" ON "program_element_budget_position" ("pe_code", "asserted_fy");
CREATE INDEX "program_element_budget_position_cycle_idx" ON "program_element_budget_position" ("position_cycle");
CREATE INDEX "program_element_budget_position_source_document_idx" ON "program_element_budget_position" ("source_document_id");

-- FK to the PE (cascade: a retired/removed PE drops its positions).
ALTER TABLE "program_element_budget_position"
    ADD CONSTRAINT "program_element_budget_position_pe_code_fkey"
    FOREIGN KEY ("pe_code") REFERENCES "program_element"("pe_code") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK to the source-document registry (SET NULL: docs are never deleted, but if one
-- were, the provenance link is cleared rather than dropping the position row).
ALTER TABLE "program_element_budget_position"
    ADD CONSTRAINT "program_element_budget_position_source_document_id_fkey"
    FOREIGN KEY ("source_document_id") REFERENCES "source_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
