-- Senate LDA Federal Lobbying Intelligence
-- GLOBAL tables -- shared across all tenants. NO tenant_id, NO RLS.
-- Populated by apps/api/scripts/sync-lda.ts

-- Requires pg_trgm extension (already enabled in prior migrations)

-- lda_filing (core -- ~512K records)
CREATE TABLE "lda_filing" (
    "id"                    UUID          NOT NULL DEFAULT gen_random_uuid(),
    "filing_uuid"           TEXT          NOT NULL,
    "filing_type"           TEXT          NOT NULL,
    "filing_year"           INTEGER       NOT NULL,
    "filing_period"         TEXT,
    "income"                DECIMAL(18,2),
    "expenses"              DECIMAL(18,2),
    "dt_posted"             TIMESTAMPTZ(6),
    "registrant_id"         INTEGER,
    "registrant_name"       TEXT          NOT NULL DEFAULT '',
    "client_id"             INTEGER,
    "client_name"           TEXT          NOT NULL DEFAULT '',
    "client_state"          TEXT,
    "client_country"        TEXT          NOT NULL DEFAULT 'US',
    "client_description"    TEXT,
    "issue_codes"           TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
    "government_entities"   JSONB         NOT NULL DEFAULT '[]',
    "lobbyists"             JSONB         NOT NULL DEFAULT '[]',
    "lobbying_activities"   JSONB         NOT NULL DEFAULT '[]',
    "filing_document_url"   TEXT,
    "last_synced_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lda_filing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lda_filing_uuid_key"         ON "lda_filing"("filing_uuid");
CREATE INDEX "lda_filing_year_idx"                ON "lda_filing"("filing_year");
CREATE INDEX "lda_filing_dt_posted_idx"           ON "lda_filing"("dt_posted");
CREATE INDEX "lda_filing_client_id_idx"           ON "lda_filing"("client_id");
CREATE INDEX "lda_filing_registrant_id_idx"       ON "lda_filing"("registrant_id");
CREATE INDEX "lda_filing_client_name_idx"         ON "lda_filing"("client_name");
CREATE INDEX "lda_filing_registrant_name_idx"     ON "lda_filing"("registrant_name");
CREATE INDEX "lda_filing_issue_codes_gin_idx"     ON "lda_filing" USING gin ("issue_codes");
CREATE INDEX "lda_filing_client_name_trgm_idx"    ON "lda_filing" USING gin ("client_name" gin_trgm_ops);

-- lda_client (~134K records)
CREATE TABLE "lda_client" (
    "id"                    INTEGER       NOT NULL,
    "name"                  TEXT          NOT NULL,
    "general_description"   TEXT,
    "state"                 TEXT,
    "country"               TEXT          NOT NULL DEFAULT 'US',
    "effective_date"        DATE,
    "total_filings"         INTEGER       NOT NULL DEFAULT 0,
    "total_spending"        DECIMAL(18,2),
    "latest_filing_year"    INTEGER,
    "issue_codes"           TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
    "last_synced_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lda_client_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lda_client_name_idx"      ON "lda_client"("name");
CREATE INDEX "lda_client_state_idx"     ON "lda_client"("state");
CREATE INDEX "lda_client_name_trgm_idx" ON "lda_client" USING gin ("name" gin_trgm_ops);

-- lda_registrant (~17K records)
CREATE TABLE "lda_registrant" (
    "id"                    INTEGER       NOT NULL,
    "house_registrant_id"   INTEGER,
    "name"                  TEXT          NOT NULL,
    "description"           TEXT,
    "address"               TEXT,
    "city"                  TEXT,
    "state"                 TEXT,
    "country"               TEXT          NOT NULL DEFAULT 'US',
    "contact_name"          TEXT,
    "contact_phone"         TEXT,
    "total_filings"         INTEGER       NOT NULL DEFAULT 0,
    "total_clients"         INTEGER       NOT NULL DEFAULT 0,
    "last_synced_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lda_registrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lda_registrant_name_idx" ON "lda_registrant"("name");

-- lda_lobbyist (~88K records)
CREATE TABLE "lda_lobbyist" (
    "id"                    INTEGER       NOT NULL,
    "first_name"            TEXT          NOT NULL DEFAULT '',
    "last_name"             TEXT          NOT NULL DEFAULT '',
    "prefix"                TEXT,
    "suffix"                TEXT,
    "covered_positions"     JSONB         NOT NULL DEFAULT '[]',
    "registrant_ids"        INTEGER[]     NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "active_years"          INTEGER[]     NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "last_synced_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lda_lobbyist_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lda_lobbyist_name_idx"      ON "lda_lobbyist"("last_name", "first_name");
CREATE INDEX "lda_lobbyist_name_trgm_idx" ON "lda_lobbyist" USING gin ("last_name" gin_trgm_ops);

-- lda_contribution (~192K records)
CREATE TABLE "lda_contribution" (
    "id"                    UUID          NOT NULL DEFAULT gen_random_uuid(),
    "filing_uuid"           TEXT          NOT NULL,
    "filing_type"           TEXT          NOT NULL,
    "filing_year"           INTEGER       NOT NULL,
    "filing_period"         TEXT,
    "filer_type"            TEXT          NOT NULL DEFAULT 'registrant',
    "dt_posted"             TIMESTAMPTZ(6),
    "registrant_id"         INTEGER,
    "registrant_name"       TEXT,
    "lobbyist_id"           INTEGER,
    "lobbyist_name"         TEXT,
    "no_contributions"      BOOLEAN       NOT NULL DEFAULT false,
    "pacs"                  JSONB         NOT NULL DEFAULT '[]',
    "contribution_items"    JSONB         NOT NULL DEFAULT '[]',
    "last_synced_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lda_contribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lda_contribution_uuid_key"   ON "lda_contribution"("filing_uuid");
CREATE INDEX "lda_contribution_year_idx"          ON "lda_contribution"("filing_year");
CREATE INDEX "lda_contribution_registrant_id_idx" ON "lda_contribution"("registrant_id");

-- lda_issue_code (79 reference records)
CREATE TABLE "lda_issue_code" (
    "code"                  TEXT          NOT NULL,
    "name"                  TEXT          NOT NULL,
    "total_filings_5y"      INTEGER       NOT NULL DEFAULT 0,
    "total_spending_5y"     DECIMAL(18,2),
    "quarterly_trend"       JSONB         NOT NULL DEFAULT '[]',
    "last_synced_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lda_issue_code_pkey" PRIMARY KEY ("code")
);

-- lda_government_entity (257 reference records)
CREATE TABLE "lda_government_entity" (
    "id"                    INTEGER       NOT NULL,
    "name"                  TEXT          NOT NULL,
    "total_filings_5y"      INTEGER       NOT NULL DEFAULT 0,
    "last_synced_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lda_government_entity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lda_government_entity_filings_idx" ON "lda_government_entity"("total_filings_5y" DESC);
