-- Step 3.1 — SAM.gov contract-opportunities ingestion + review-gated opportunity ->
-- program / PE matching. Both tables are GLOBAL public-domain federal data (no
-- tenant_id / RLS), same as federal_award / program. Purely additive: no existing
-- rows are written or altered.
--
-- sam_opportunity_match mirrors pe_program_match / provision_pe_link review gating:
-- machine matches land as 'candidate' or 'quarantined'; only a verbatim PE-code hit
-- in the description is 'accepted'. PSC/NAICS-only matches are 'quarantined' and are
-- NEVER auto-accepted.

-- ── sam_opportunity (one row per SAM.gov notice) ─────────────────────────────
CREATE TABLE "sam_opportunity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notice_id" TEXT NOT NULL,
    "solicitation_number" TEXT,
    "title" TEXT NOT NULL,
    "notice_type" VARCHAR(32) NOT NULL,
    "agency" TEXT,
    "office" TEXT,
    "psc_code" VARCHAR(8),
    "naics_code" VARCHAR(8),
    "posted_date" TIMESTAMPTZ(6),
    "response_deadline" TIMESTAMPTZ(6),
    "archive_date" TIMESTAMPTZ(6),
    "description" TEXT,
    "poc_name" TEXT,
    "poc_email" TEXT,
    "place_of_performance_jsonb" JSONB NOT NULL DEFAULT '{}',
    "source_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "raw_jsonb" JSONB NOT NULL DEFAULT '{}',
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "sam_opportunity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sam_opportunity_notice_id_key" ON "sam_opportunity" ("notice_id");
CREATE INDEX "sam_opportunity_active_response_deadline_idx" ON "sam_opportunity" ("active", "response_deadline");
CREATE INDEX "sam_opportunity_naics_code_idx" ON "sam_opportunity" ("naics_code");
CREATE INDEX "sam_opportunity_psc_code_idx" ON "sam_opportunity" ("psc_code");
CREATE INDEX "sam_opportunity_office_idx" ON "sam_opportunity" ("office");

-- ── sam_opportunity_match (review-gated opportunity -> program / PE link) ─────
CREATE TABLE "sam_opportunity_match" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL,
    "program_id" UUID,
    "pe_code" VARCHAR(16),
    "match_basis" VARCHAR(24) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "review_status" VARCHAR(20) NOT NULL DEFAULT 'candidate',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "sam_opportunity_match_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sam_opportunity_match_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sam_opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sam_opportunity_match_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Unique on (opportunity_id, coalesce(program_id::text,''), coalesce(pe_code,'')) —
-- Postgres treats NULLs as distinct, so a functional unique index over coalesce() is
-- required to make program-null / pe-null matches idempotent for upserts (Prisma
-- cannot express this).
CREATE UNIQUE INDEX "sam_opportunity_match_opp_program_pe_key" ON "sam_opportunity_match" ("opportunity_id", (COALESCE("program_id"::text, '')), (COALESCE("pe_code", '')));
CREATE INDEX "sam_opportunity_match_program_id_idx" ON "sam_opportunity_match" ("program_id");
CREATE INDEX "sam_opportunity_match_pe_code_idx" ON "sam_opportunity_match" ("pe_code");
CREATE INDEX "sam_opportunity_match_review_status_idx" ON "sam_opportunity_match" ("review_status");
