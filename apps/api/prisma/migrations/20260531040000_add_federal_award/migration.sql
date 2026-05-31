-- Federal awards from USAspending.gov, enriched with PE attribution.
-- Global table (no tenant_id, no RLS). pe_code nullable — awards without a
-- resolvable PE keep pe_code NULL (not quarantined). Step 6 /contractors reads
-- contractor_name + amount + awarded_at + pe_code.
CREATE TABLE IF NOT EXISTS "federal_award" (
    "id" UUID NOT NULL,
    "award_unique_id" TEXT NOT NULL,
    "piid" TEXT,
    "fain" TEXT,
    "awarding_agency" TEXT,
    "awarding_sub_tier" TEXT,
    "contractor_name" TEXT,
    "recipient_uei" TEXT,
    "amount" DECIMAL(18,2),
    "description" TEXT,
    "pe_code" VARCHAR(8),
    "action_date" DATE,
    "awarded_at" TIMESTAMPTZ(6),
    "raw_jsonb" JSONB NOT NULL DEFAULT '{}',
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "federal_award_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "federal_award_award_unique_id_key"
    ON "federal_award" ("award_unique_id");
CREATE INDEX IF NOT EXISTS "federal_award_pe_code_idx" ON "federal_award" ("pe_code");
CREATE INDEX IF NOT EXISTS "federal_award_contractor_name_idx" ON "federal_award" ("contractor_name");
CREATE INDEX IF NOT EXISTS "federal_award_awarded_at_idx" ON "federal_award" ("awarded_at");
CREATE INDEX IF NOT EXISTS "federal_award_action_date_idx" ON "federal_award" ("action_date");
