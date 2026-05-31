-- Schedule B — disbursements BY a committee (PAC) TO candidates/committees.
-- The organization's OWN PAC giving, legally distinct from the individual
-- employer-linked contributions in fec_contribution (Schedule A).
-- Global table (no tenant_id, no RLS). Attributed to a client via a confirmed
-- ClientIntelMapping(source='fec_committee') linking client -> committee_id.
CREATE TABLE IF NOT EXISTS "fec_pac_contribution" (
    "id" UUID NOT NULL,
    "committee_id" TEXT NOT NULL,
    "committee_name" TEXT,
    "recipient_name" TEXT,
    "recipient_committee_id" TEXT,
    "candidate_id" TEXT,
    "candidate_name" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "disbursement_date" DATE,
    "disbursement_type" TEXT,
    "memo_text" TEXT,
    "cycle" INTEGER NOT NULL,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "fec_pac_contribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "fec_pac_contribution_dedup_key"
    ON "fec_pac_contribution" ("committee_id", "recipient_name", "amount", "disbursement_date", "cycle");
CREATE INDEX IF NOT EXISTS "fec_pac_contribution_committee_id_idx"
    ON "fec_pac_contribution" ("committee_id");
CREATE INDEX IF NOT EXISTS "fec_pac_contribution_candidate_name_idx"
    ON "fec_pac_contribution" ("candidate_name");
CREATE INDEX IF NOT EXISTS "fec_pac_contribution_cycle_idx"
    ON "fec_pac_contribution" ("cycle");
