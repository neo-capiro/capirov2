-- Federal Spending Intelligence (OpenSpending / USASpending-derived reference data)
-- GLOBAL tables — shared across all tenants. NO tenant_id, NO RLS.

-- CreateTable federal_contractor
CREATE TABLE "federal_contractor" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "uei" TEXT,
    "recipient_id" TEXT,
    "total_contracts" DECIMAL(18,2),
    "pct_of_all_contracts" DOUBLE PRECISION,
    "cost_per_taxpayer" DOUBLE PRECISION,
    "category" TEXT,
    "subsidiaries" INTEGER,
    "yearly_spend_jsonb" JSONB NOT NULL DEFAULT '[]',
    "top_agencies_jsonb" JSONB NOT NULL DEFAULT '[]',
    "top_awards_jsonb" JSONB NOT NULL DEFAULT '[]',
    "no_bid_awards_jsonb" JSONB NOT NULL DEFAULT '[]',
    "no_bid_total" DECIMAL(18,2),
    "rank_by_contracts" INTEGER,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_jsonb" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "federal_contractor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "federal_contractor_name_key" ON "federal_contractor"("name");
CREATE INDEX "federal_contractor_name_idx" ON "federal_contractor"("name");
CREATE INDEX "federal_contractor_uei_idx" ON "federal_contractor"("uei");

-- Trigram index for fuzzy matching of Capiro client names to contractor names.
CREATE INDEX IF NOT EXISTS "federal_contractor_name_trgm_idx" ON "federal_contractor" USING gin ("name" gin_trgm_ops);

-- CreateTable federal_agency
CREATE TABLE "federal_agency" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT,
    "code" TEXT,
    "display_name" TEXT,
    "budget_authority" DECIMAL(18,2),
    "obligated" DECIMAL(18,2),
    "outlays" DECIMAL(18,2),
    "pct_of_total" DOUBLE PRECISION,
    "pct_of_budget" DOUBLE PRECISION,
    "pct_contracts" DOUBLE PRECISION,
    "cost_per_american" DOUBLE PRECISION,
    "rank_by_spending" INTEGER,
    "contracts_total" DECIMAL(18,2),
    "grants_total" DECIMAL(18,2),
    "yearly_budget_jsonb" JSONB NOT NULL DEFAULT '[]',
    "top_contractors_jsonb" JSONB NOT NULL DEFAULT '[]',
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "federal_agency_pkey" PRIMARY KEY ("slug")
);

CREATE INDEX "federal_agency_name_idx" ON "federal_agency"("name");

-- CreateTable federal_industry
CREATE TABLE "federal_industry" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "total_spending" DECIMAL(18,2),
    "rank" INTEGER,
    "pct_of_total" DOUBLE PRECISION,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "federal_industry_pkey" PRIMARY KEY ("code")
);
