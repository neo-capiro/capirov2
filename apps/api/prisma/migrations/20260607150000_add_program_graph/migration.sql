-- Step 2.1 — Program graph spine: the canonical Program entity + alias dictionary +
-- review-gated PE/project -> program matching (plan §7 evidence tiers + thresholds, §13
-- matching objects). All three tables are GLOBAL reference data (no tenant_id / RLS),
-- same as program_element / federal_award.
--
-- Purely additive: no existing rows are written or altered. program_element_acquisition_program
-- is kept as-is (award attribution still reads it); pe_program_match is the graph's source of
-- truth going forward and is populated by seed-programs.ts + the matcher / human review.

-- ── program (canonical program-of-record) ───────────────────────────────────
CREATE TABLE "program" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "canonical_name" TEXT NOT NULL,
    "component" TEXT,
    "capability_area" TEXT,
    "acquisition_pathway" TEXT,
    "mdap_code" TEXT,
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "program_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "program_mdap_code_idx" ON "program" ("mdap_code");
CREATE INDEX "program_component_idx" ON "program" ("component");
CREATE INDEX "program_status_idx" ON "program" ("status");

-- ── program_alias (alias dictionary; drives fuzzy matching) ──────────────────
CREATE TABLE "program_alias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "program_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "alias_normalized" TEXT NOT NULL,
    "alias_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_url" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "program_alias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "program_alias_program_norm_type_key"
    ON "program_alias" ("program_id", "alias_normalized", "alias_type");
CREATE INDEX "program_alias_program_id_idx" ON "program_alias" ("program_id");
CREATE INDEX "program_alias_normalized_idx" ON "program_alias" ("alias_normalized");
-- pg_trgm GIN index for similarity()/% trigram matching on the normalized alias
-- (pg_trgm extension is enabled by 20260529142000_enable_pg_trgm_extension).
CREATE INDEX "program_alias_normalized_trgm_idx"
    ON "program_alias" USING gin ("alias_normalized" gin_trgm_ops);

ALTER TABLE "program_alias"
    ADD CONSTRAINT "program_alias_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── pe_program_match (review-gated PE/project -> program link + evidence) ─────
CREATE TABLE "pe_program_match" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pe_code" VARCHAR(16) NOT NULL,
    "project_code" VARCHAR(8),
    "program_id" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "evidence_tier" TEXT NOT NULL,
    "evidence_jsonb" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'candidate',
    "weak_signal" BOOLEAN NOT NULL DEFAULT false,
    "match_basis" TEXT,
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "decision_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "pe_program_match_pkey" PRIMARY KEY ("id")
);

-- Unique on (pe_code, coalesce(project_code,''), program_id). Postgres treats NULLs as
-- distinct, so a functional unique index over coalesce() is required to make
-- (pe, project=NULL, program) idempotent for upserts (Prisma cannot express this).
CREATE UNIQUE INDEX "pe_program_match_pe_project_program_key"
    ON "pe_program_match" ("pe_code", (COALESCE("project_code", '')), "program_id");
CREATE INDEX "pe_program_match_program_id_idx" ON "pe_program_match" ("program_id");
CREATE INDEX "pe_program_match_pe_code_idx" ON "pe_program_match" ("pe_code");
CREATE INDEX "pe_program_match_status_idx" ON "pe_program_match" ("status");

ALTER TABLE "pe_program_match"
    ADD CONSTRAINT "pe_program_match_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
