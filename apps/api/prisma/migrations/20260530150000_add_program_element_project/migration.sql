-- Adds project-level (R-2A) detail for Program Elements, sourced from Service
-- RDT&E Justification Book R-2A exhibits. Global table (no tenant_id / RLS):
-- J-book data is public-domain and read-only via API. Mirrors
-- program_element_source conventions (cascade FK to program_element).
--
-- The PE-level R-2 mission narrative is stored in the existing
-- program_element.description column (no schema change needed for that).

CREATE TABLE IF NOT EXISTS "program_element_project" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "pe_code"          VARCHAR(8)   NOT NULL,
    "project_code"     VARCHAR(8)   NOT NULL,
    "title"            TEXT         NOT NULL,
    "mission"          TEXT,
    "budget_activity"  TEXT,
    "fy"               INTEGER,
    "source_url"       TEXT,
    "page_number"      INTEGER,
    "source"           TEXT         NOT NULL DEFAULT 'comptroller_jbook_r2a',
    "confidence"       DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "metadata_jsonb"   JSONB        NOT NULL DEFAULT '{}',
    "first_seen_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "last_synced_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "program_element_project_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "program_element_project_pe_code_project_key"
    ON "program_element_project" ("pe_code", "project_code");

CREATE INDEX IF NOT EXISTS "program_element_project_pe_code_idx"
    ON "program_element_project" ("pe_code");

-- Cascade delete with the parent Program Element (matches program_element_source).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'program_element_project_pe_code_fkey'
  ) THEN
    ALTER TABLE "program_element_project"
      ADD CONSTRAINT "program_element_project_pe_code_fkey"
      FOREIGN KEY ("pe_code") REFERENCES "program_element" ("pe_code")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
