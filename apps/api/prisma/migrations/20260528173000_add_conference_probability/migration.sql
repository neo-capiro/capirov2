-- Migration: add_conference_probability
-- Global cache table for conference probability predictions.

CREATE TABLE IF NOT EXISTS "conference_probability" (
  "pe_code" VARCHAR(8) NOT NULL,
  "fy" INTEGER NOT NULL,
  "predicted" DECIMAL(14,4) NOT NULL,
  "ci_low" DECIMAL(14,4) NOT NULL,
  "ci_high" DECIMAL(14,4) NOT NULL,
  "confidence" DECIMAL(6,4) NOT NULL,
  "model_version" TEXT NOT NULL,
  "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "conference_probability_pkey" PRIMARY KEY ("pe_code", "fy")
);

CREATE INDEX IF NOT EXISTS "conference_probability_fy_idx" ON "conference_probability"("fy");
CREATE INDEX IF NOT EXISTS "conference_probability_model_version_idx" ON "conference_probability"("model_version");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conference_probability_pe_code_fkey'
  ) THEN
    ALTER TABLE "conference_probability"
    ADD CONSTRAINT "conference_probability_pe_code_fkey"
    FOREIGN KEY ("pe_code") REFERENCES "program_element"("pe_code") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
