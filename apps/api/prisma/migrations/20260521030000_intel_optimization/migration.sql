-- CreateTable: federal_register_document
CREATE TABLE "federal_register_document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "abstract" TEXT,
    "agency_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publication_date" TIMESTAMPTZ(6) NOT NULL,
    "comment_end_date" TIMESTAMPTZ(6),
    "effective_date" TIMESTAMPTZ(6),
    "docket_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cfr_references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "html_url" TEXT,
    "pdf_url" TEXT,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "significant_rule" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "federal_register_document_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "federal_register_document_document_number_key" ON "federal_register_document"("document_number");
CREATE INDEX "federal_register_document_type_publication_date_idx" ON "federal_register_document"("type", "publication_date");
CREATE INDEX "federal_register_document_comment_end_date_idx" ON "federal_register_document"("comment_end_date");

-- CreateTable: congress_bill_action
CREATE TABLE "congress_bill_action" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bill_id" TEXT NOT NULL,
    "date" TIMESTAMPTZ(6) NOT NULL,
    "text" TEXT NOT NULL,
    "type" TEXT,
    "chamber" TEXT,
    CONSTRAINT "congress_bill_action_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "congress_bill_action_bill_id_date_idx" ON "congress_bill_action"("bill_id", "date");
ALTER TABLE "congress_bill_action" ADD CONSTRAINT "congress_bill_action_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "congress_bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: congress_bill_committee
CREATE TABLE "congress_bill_committee" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bill_id" TEXT NOT NULL,
    "committee_name" TEXT NOT NULL,
    "committee_code" TEXT,
    "chamber" TEXT,
    CONSTRAINT "congress_bill_committee_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "congress_bill_committee_bill_id_idx" ON "congress_bill_committee"("bill_id");
CREATE INDEX "congress_bill_committee_committee_code_idx" ON "congress_bill_committee"("committee_code");
ALTER TABLE "congress_bill_committee" ADD CONSTRAINT "congress_bill_committee_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "congress_bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: congress_bill_subject
CREATE TABLE "congress_bill_subject" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bill_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "congress_bill_subject_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "congress_bill_subject_bill_id_idx" ON "congress_bill_subject"("bill_id");
CREATE INDEX "congress_bill_subject_name_idx" ON "congress_bill_subject"("name");
ALTER TABLE "congress_bill_subject" ADD CONSTRAINT "congress_bill_subject_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "congress_bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: intelligence_insight
CREATE TABLE "intelligence_insight" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "data_points" JSONB,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    CONSTRAINT "intelligence_insight_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "intelligence_insight_category_generated_at_idx" ON "intelligence_insight"("category", "generated_at");
