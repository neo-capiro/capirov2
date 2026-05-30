-- CreateTable: page-level provenance for Program Elements (DoD Comptroller J-books)
-- Global table (no tenant_id / RLS): public-domain budget data, read-only via API.
-- Each row is one citation users can open at the exact page via `${source_url}#page=${page_number}`.
CREATE TABLE "program_element_source" (
    "id" UUID NOT NULL,
    "pe_code" VARCHAR(8) NOT NULL,
    "doc_type" VARCHAR(8) NOT NULL,
    "exhibit_type" VARCHAR(16),
    "fy" INTEGER,
    "source_url" TEXT NOT NULL,
    "page_number" INTEGER,
    "page_end" INTEGER,
    "snippet" TEXT,
    "publisher" VARCHAR(64),
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    "observed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "program_element_source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "program_element_source_pe_code_idx" ON "program_element_source"("pe_code");

-- CreateIndex
CREATE INDEX "program_element_source_pe_fy_idx" ON "program_element_source"("pe_code", "fy");

-- CreateIndex
CREATE INDEX "program_element_source_doc_type_idx" ON "program_element_source"("doc_type");

-- CreateIndex
CREATE UNIQUE INDEX "program_element_source_pe_doc_url_page_key" ON "program_element_source"("pe_code", "doc_type", "source_url", "page_number");

-- AddForeignKey
ALTER TABLE "program_element_source" ADD CONSTRAINT "program_element_source_pe_code_fkey" FOREIGN KEY ("pe_code") REFERENCES "program_element"("pe_code") ON DELETE CASCADE ON UPDATE CASCADE;
