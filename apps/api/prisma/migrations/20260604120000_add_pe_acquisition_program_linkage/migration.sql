-- PE -> contractor linkage via DoD Acquisition Program (MDAP).
--
-- USAspending carries NO Program Element code on contracts (verified: award
-- descriptions 0/2000; funding accounts are program-activity level, coarser than
-- a PE). It DOES carry the contract's DoD acquisition program code on every
-- contract record (latest_transaction_contract_data.dod_acquisition_program),
-- e.g. '198'/'F-35', '516'/'SSN 774'. We persist that code on federal_award and
-- bridge it to PEs through an explicit, reviewed map table so the contractor
-- panel can show primes with honest provenance instead of an empty box or a
-- fabricated PE attribution.
--
-- Additive + idempotent. federal_award stays a global table (no tenant_id, no
-- RLS); the new map table is likewise global federal reference data. No backfill
-- here — the enrich-award-pe task + sync-federal-award re-run populate columns.

ALTER TABLE "federal_award" ADD COLUMN IF NOT EXISTS "pe_code_source" TEXT;
ALTER TABLE "federal_award" ADD COLUMN IF NOT EXISTS "dod_acq_program_code" TEXT;
ALTER TABLE "federal_award" ADD COLUMN IF NOT EXISTS "dod_acq_program_name" TEXT;

CREATE INDEX IF NOT EXISTS "federal_award_dod_acq_program_idx"
    ON "federal_award" ("dod_acq_program_code");

CREATE TABLE IF NOT EXISTS "program_element_acquisition_program" (
    "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
    "acq_program_code"  TEXT         NOT NULL,
    "acq_program_name"  TEXT,
    "pe_code"           VARCHAR(16)  NOT NULL,
    "source"            TEXT         NOT NULL DEFAULT 'seed_curated_v1',
    "confidence"        DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "last_synced_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "program_element_acquisition_program_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pe_acq_program_code_pe_key"
    ON "program_element_acquisition_program" ("acq_program_code", "pe_code");
CREATE INDEX IF NOT EXISTS "pe_acq_program_pe_code_idx"
    ON "program_element_acquisition_program" ("pe_code");
CREATE INDEX IF NOT EXISTS "pe_acq_program_code_idx"
    ON "program_element_acquisition_program" ("acq_program_code");
