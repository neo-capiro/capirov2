-- Step 2.4 — Committee report LANGUAGE (narrative provisions, not just dollar tables) +
-- their links to PEs/projects/programs. GLOBAL public-domain congressional data (no
-- tenant_id / RLS), like program / source_document. Purely additive.

CREATE TABLE "committee_report_provision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_document_id" UUID,
    "committee" VARCHAR(16) NOT NULL,
    "fy" INTEGER NOT NULL,
    "heading" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "action_type" VARCHAR(24),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "committee_report_provision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "committee_report_provision_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_document"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "committee_report_provision_committee_fy_idx" ON "committee_report_provision" ("committee", "fy");
CREATE INDEX "committee_report_provision_action_type_idx" ON "committee_report_provision" ("action_type");
CREATE INDEX "committee_report_provision_source_document_idx" ON "committee_report_provision" ("source_document_id");

CREATE TABLE "provision_pe_link" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provision_id" UUID NOT NULL,
    "pe_code" VARCHAR(16),
    "project_code" VARCHAR(8),
    "program_id" UUID,
    "match_basis" VARCHAR(24) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "review_status" VARCHAR(20) NOT NULL DEFAULT 'candidate',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "provision_pe_link_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "provision_pe_link_provision_id_fkey" FOREIGN KEY ("provision_id") REFERENCES "committee_report_provision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "provision_pe_link_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Unique on (provision_id, coalesce(pe_code,''), coalesce(program_id::text,'')) — Postgres
-- treats NULLs as distinct, so a functional unique index is required (Prisma cannot express it).
CREATE UNIQUE INDEX "provision_pe_link_provision_pe_program_key" ON "provision_pe_link" ("provision_id", (COALESCE("pe_code", '')), (COALESCE("program_id"::text, '')));
CREATE INDEX "provision_pe_link_pe_code_idx" ON "provision_pe_link" ("pe_code");
CREATE INDEX "provision_pe_link_program_id_idx" ON "provision_pe_link" ("program_id");
CREATE INDEX "provision_pe_link_review_status_idx" ON "provision_pe_link" ("review_status");
