-- CreateTable: regulatory_docket
CREATE TABLE "regulatory_docket" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "docket_id" TEXT,
    "document_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "posted_date" TIMESTAMPTZ(6),
    "comment_start_date" TIMESTAMPTZ(6),
    "comment_end_date" TIMESTAMPTZ(6),
    "fr_doc_num" TEXT,
    "subtype" TEXT,
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,
    "last_modified" TIMESTAMPTZ(6),
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "regulatory_docket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "regulatory_docket_document_id_key" ON "regulatory_docket"("document_id");
CREATE INDEX "regulatory_docket_agency_id_posted_date_idx" ON "regulatory_docket"("agency_id", "posted_date");
CREATE INDEX "regulatory_docket_comment_end_date_idx" ON "regulatory_docket"("comment_end_date");
CREATE INDEX "regulatory_docket_document_type_idx" ON "regulatory_docket"("document_type");
