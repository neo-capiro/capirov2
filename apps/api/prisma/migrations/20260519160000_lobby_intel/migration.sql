-- Federal Lobbying Intelligence (OpenLobby / Senate LDA-derived reference data)
-- GLOBAL tables — shared across all tenants. NO tenant_id, NO RLS.

-- CreateTable lobby_intel
CREATE TABLE "lobby_intel" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT,
    "total_spending" DECIMAL(18,2),
    "filings" INTEGER,
    "issues" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "years" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "trajectory" TEXT,
    "growth_rate" DOUBLE PRECISION,
    "yearly_spend_jsonb" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'openlobby',
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_jsonb" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "lobby_intel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lobby_intel_slug_key" ON "lobby_intel"("slug");
CREATE INDEX "lobby_intel_name_idx" ON "lobby_intel"("name");
CREATE INDEX "lobby_intel_slug_idx" ON "lobby_intel"("slug");

-- Trigram index on name for fuzzy matching to capiro clients.
CREATE INDEX IF NOT EXISTS "lobby_intel_name_trgm_idx" ON "lobby_intel" USING gin ("name" gin_trgm_ops);

-- CreateTable lobby_issue_ref
CREATE TABLE "lobby_issue_ref" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "total_spending" DECIMAL(18,2),
    "total_filings" INTEGER,
    "surge_trend" TEXT,
    "surge_pct" DOUBLE PRECISION,
    "latest_quarter" TEXT,
    "latest_income" DECIMAL(18,2),
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lobby_issue_ref_pkey" PRIMARY KEY ("code")
);

-- CreateTable lobby_trending_topics
CREATE TABLE "lobby_trending_topics" (
    "id" UUID NOT NULL,
    "word" TEXT NOT NULL,
    "latest_count" INTEGER NOT NULL,
    "avg_prior" DOUBLE PRECISION,
    "growth_pct" DOUBLE PRECISION,
    "kind" TEXT NOT NULL DEFAULT 'trending',
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lobby_trending_topics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lobby_trending_topics_word_key" ON "lobby_trending_topics"("word");
CREATE INDEX "lobby_trending_kind_growth_idx" ON "lobby_trending_topics"("kind", "growth_pct");
