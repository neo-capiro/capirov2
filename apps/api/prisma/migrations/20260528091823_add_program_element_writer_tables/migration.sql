-- Migration: add_program_element_writer_tables
-- Adds writer support tables for quarantine and source-priority provenance.

-- CreateTable
CREATE TABLE "program_element_quarantine" (
  "id" UUID NOT NULL,
  "raw_record" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "quarantined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "program_element_quarantine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_element_year_source_value" (
  "id" UUID NOT NULL,
  "pe_code" VARCHAR(8) NOT NULL,
  "fy" INTEGER NOT NULL,
  "field_name" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "value_jsonb" JSONB NOT NULL DEFAULT 'null'::jsonb,
  "is_winner" BOOLEAN NOT NULL DEFAULT false,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "program_element_year_source_value_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "program_element_year_source_value_lookup_idx"
ON "program_element_year_source_value"("pe_code", "fy", "field_name");

-- CreateIndex
CREATE INDEX "program_element_year_source_value_winner_idx"
ON "program_element_year_source_value"("pe_code", "fy", "field_name", "is_winner");

-- AddForeignKey
ALTER TABLE "program_element_year_source_value"
ADD CONSTRAINT "program_element_year_source_value_pe_code_fkey"
FOREIGN KEY ("pe_code") REFERENCES "program_element"("pe_code")
ON DELETE CASCADE ON UPDATE CASCADE;
