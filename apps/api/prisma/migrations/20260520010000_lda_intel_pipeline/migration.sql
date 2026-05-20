-- FEC and Congress.gov tables for LDA Intel pipeline
-- GLOBAL tables -- shared across all tenants. NO tenant_id, NO RLS.
-- Requires pg_trgm extension (already enabled).

-- fec_committee (PACs and campaign committees from FEC API)
CREATE TABLE "fec_committee" (
    "id"                    TEXT           NOT NULL,  -- committee_id like C00835926
    "name"                  TEXT           NOT NULL,
    "committee_type"        TEXT,
    "designation"           TEXT,
    "party"                 TEXT,
    "state"                 TEXT,
    "treasurer_name"        TEXT,
    "total_receipts"        DECIMAL(18,2),
    "total_disbursements"   DECIMAL(18,2),
    "cash_on_hand"          DECIMAL(18,2),
    "cycles"                INTEGER[]      NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "last_synced_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fec_committee_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fec_committee_name_idx" ON "fec_committee"("name");

-- fec_contribution (individual/PAC contributions from FEC Schedule A)
CREATE TABLE "fec_contribution" (
    "id"                        UUID           NOT NULL DEFAULT gen_random_uuid(),
    "committee_id"              TEXT           NOT NULL,
    "committee_name"            TEXT,
    "candidate_id"              TEXT,
    "candidate_name"            TEXT,
    "contributor_name"          TEXT,
    "contributor_employer"      TEXT,
    "contributor_occupation"    TEXT,
    "amount"                    DECIMAL(18,2)  NOT NULL,
    "contribution_date"         DATE,
    "receipt_type"              TEXT,
    "memo_text"                 TEXT,
    "state"                     TEXT,
    "cycle"                     INTEGER        NOT NULL,
    "last_synced_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fec_contribution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fec_contribution_committee_id_idx"  ON "fec_contribution"("committee_id");
CREATE INDEX "fec_contribution_candidate_name_idx" ON "fec_contribution"("candidate_name");
CREATE INDEX "fec_contribution_employer_idx"       ON "fec_contribution"("contributor_employer");
CREATE INDEX "fec_contribution_cycle_idx"          ON "fec_contribution"("cycle");

-- congress_bill (bills from Congress.gov API)
CREATE TABLE "congress_bill" (
    "id"                    TEXT           NOT NULL,  -- e.g. "119-hr-1234"
    "congress"              INTEGER        NOT NULL,
    "bill_type"             TEXT           NOT NULL,
    "bill_number"           TEXT           NOT NULL,
    "title"                 TEXT           NOT NULL,
    "introduced_date"       DATE,
    "sponsor_name"          TEXT,
    "sponsor_state"         TEXT,
    "sponsor_party"         TEXT,
    "latest_action_text"    TEXT,
    "latest_action_date"    DATE,
    "policy_area"           TEXT,
    "subjects"              TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "committees"            JSONB          NOT NULL DEFAULT '[]',
    "cosponsors_count"      INTEGER        NOT NULL DEFAULT 0,
    "origin_chamber"        TEXT,
    "update_date"           TIMESTAMPTZ(6),
    "url"                   TEXT,
    "last_synced_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "congress_bill_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "congress_bill_congress_idx"     ON "congress_bill"("congress");
CREATE INDEX "congress_bill_policy_area_idx"  ON "congress_bill"("policy_area");
CREATE INDEX "congress_bill_subjects_gin_idx" ON "congress_bill" USING gin ("subjects");
CREATE INDEX "congress_bill_title_trgm_idx"   ON "congress_bill" USING gin ("title" gin_trgm_ops);
