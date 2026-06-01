-- Step 29 cross-source reconciliation (§4.1).
-- Additive columns on the existing per-source value table (won't disturb the
-- writer's existing valueJsonb/isWinner usage).
ALTER TABLE "program_element_year_source_value"
    ADD COLUMN IF NOT EXISTS "value_decimal" DECIMAL(18,2),
    ADD COLUMN IF NOT EXISTS "value_text" TEXT,
    ADD COLUMN IF NOT EXISTS "written_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

-- Reconciliation review queue for capiro_admin.
CREATE TABLE IF NOT EXISTS "reconciliation_review_queue" (
    "id" UUID NOT NULL,
    "pe_code" VARCHAR(16) NOT NULL,
    "fy" INTEGER NOT NULL,
    "field_name" TEXT NOT NULL,
    "current_value" TEXT,
    "conflicting_source" TEXT NOT NULL,
    "conflicting_value" TEXT,
    "delta_pct" DOUBLE PRECISION,
    "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_notes" TEXT,
    CONSTRAINT "reconciliation_review_queue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "reconciliation_review_queue_status_idx"
    ON "reconciliation_review_queue" ("status", "queued_at" DESC);
CREATE INDEX IF NOT EXISTS "reconciliation_review_queue_pe_fy_idx"
    ON "reconciliation_review_queue" ("pe_code", "fy");
