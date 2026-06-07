-- Step 0.1 — Source-document registry (plan §4.2 checksum de-duplication + version tracking,
-- §4.3 provenance incl. extraction method). GLOBAL table (no tenant_id / RLS): public-domain
-- reference data, same as program_element / federal_award. Plus additive, nullable
-- source_document_id FK columns on the four Program Element provenance tables.
--
-- Purely additive: no data is written or altered here. Existing rows get a NULL
-- source_document_id; backfill-source-documents.ts links them afterwards.

-- ── source_document registry ────────────────────────────────────────────────
CREATE TABLE "source_document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_key" TEXT NOT NULL,
    "fiscal_year" INTEGER,
    "budget_cycle" TEXT NOT NULL,
    "component" TEXT,
    "document_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "sha256" CHAR(64),
    "byte_size" INTEGER,
    "page_count" INTEGER,
    "downloaded_at" TIMESTAMPTZ(6),
    "artifact_path" TEXT,
    "extraction_method" TEXT NOT NULL,
    "extraction_tool_version" TEXT,
    "ingested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "superseded_by_document_id" UUID,
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "source_document_pkey" PRIMARY KEY ("id")
);

-- Checksum de-duplication: identical content (same sourceKey + sha256) is a no-op.
-- "One LIVE document per source_key" is enforced in upsertSourceDocument (Prisma 5 cannot
-- express the partial unique index that would enforce it at the DB level).
CREATE UNIQUE INDEX "source_document_source_key_sha256_key" ON "source_document" ("source_key", "sha256");
CREATE INDEX "source_document_type_fy_cycle_component_idx" ON "source_document" ("document_type", "fiscal_year", "budget_cycle", "component");
CREATE INDEX "source_document_source_key_idx" ON "source_document" ("source_key");

-- Self-referential version chain (old head -> new version). SET NULL: docs are never deleted,
-- but if one ever were, the chain link is cleared rather than cascading.
ALTER TABLE "source_document"
    ADD CONSTRAINT "source_document_superseded_by_document_id_fkey"
    FOREIGN KEY ("superseded_by_document_id") REFERENCES "source_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── additive nullable registry FK columns on the four PE provenance tables ────
ALTER TABLE "program_element_source" ADD COLUMN "source_document_id" UUID;
ALTER TABLE "program_element_project" ADD COLUMN "source_document_id" UUID;
ALTER TABLE "program_element_performer" ADD COLUMN "source_document_id" UUID;
ALTER TABLE "program_element_year_source_value" ADD COLUMN "source_document_id" UUID;

CREATE INDEX "program_element_source_source_document_idx" ON "program_element_source" ("source_document_id");
CREATE INDEX "program_element_project_source_document_idx" ON "program_element_project" ("source_document_id");
CREATE INDEX "program_element_performer_source_document_idx" ON "program_element_performer" ("source_document_id");
CREATE INDEX "program_element_year_source_value_source_document_idx" ON "program_element_year_source_value" ("source_document_id");

ALTER TABLE "program_element_source"
    ADD CONSTRAINT "program_element_source_source_document_id_fkey"
    FOREIGN KEY ("source_document_id") REFERENCES "source_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_element_project"
    ADD CONSTRAINT "program_element_project_source_document_id_fkey"
    FOREIGN KEY ("source_document_id") REFERENCES "source_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_element_performer"
    ADD CONSTRAINT "program_element_performer_source_document_id_fkey"
    FOREIGN KEY ("source_document_id") REFERENCES "source_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_element_year_source_value"
    ADD CONSTRAINT "program_element_year_source_value_source_document_id_fkey"
    FOREIGN KEY ("source_document_id") REFERENCES "source_document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
