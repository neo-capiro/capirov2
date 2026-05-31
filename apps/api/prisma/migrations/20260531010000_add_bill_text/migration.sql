-- Cached full bill text from GovInfo for the bill PE-code extractor.
-- Global table (no tenant_id, no RLS). One row per bill.
CREATE TABLE IF NOT EXISTS "bill_text" (
    "id" UUID NOT NULL,
    "bill_id" TEXT NOT NULL,
    "source_url" TEXT,
    "text_content" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "bill_text_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bill_text_bill_id_key" ON "bill_text" ("bill_id");
