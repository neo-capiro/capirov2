-- Child procurement line items under a parent Program Element (P-Doc / Procurement
-- budget books). Global table (no tenant_id, no RLS). Idempotent dedup on
-- (pe_code, line_description, fy). Parent PE FY totals stay on program_element_year.
CREATE TABLE IF NOT EXISTS "program_element_procurement_line" (
    "id" UUID NOT NULL,
    "pe_code" VARCHAR(16) NOT NULL,
    "line_description" TEXT NOT NULL,
    "fy" INTEGER NOT NULL,
    "quantity" DECIMAL(14,2),
    "dollars" DECIMAL(18,2),
    "unit_cost" DECIMAL(18,2),
    "source" TEXT,
    "source_url" TEXT,
    "raw_jsonb" JSONB NOT NULL DEFAULT '{}',
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "program_element_procurement_line_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pe_procurement_line_dedup_key"
    ON "program_element_procurement_line" ("pe_code", "line_description", "fy");
CREATE INDEX IF NOT EXISTS "pe_procurement_line_pe_code_idx"
    ON "program_element_procurement_line" ("pe_code");
CREATE INDEX IF NOT EXISTS "pe_procurement_line_fy_idx"
    ON "program_element_procurement_line" ("fy");
