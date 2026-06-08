-- Step 1.4 — Typed, materiality-scored budget delta (plan §6).
-- GLOBAL table (no tenant_id / RLS): the delta is public-domain budget math.
-- Purely additive — ProgramElementYear / ProgramElementBudgetPosition are untouched.
--
-- ONE live row per (pe_code, asserted_fy, delta_type, from_ref, to_ref); the engine
-- recomputes idempotently. Latest-wins: a recompute that finds a CHANGED magnitude
-- stamps superseded_at on the prior live row and inserts a fresh one, so history is
-- preserved. clientRelevance is computed PER-TENANT at read time and is NEVER stored.

CREATE TABLE "program_element_delta" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pe_code" VARCHAR(16) NOT NULL,
    "asserted_fy" INTEGER NOT NULL,
    "delta_type" TEXT NOT NULL,
    "from_ref" TEXT,
    "to_ref" TEXT,
    "amount_from" DECIMAL(14,2),
    "amount_to" DECIMAL(14,2),
    "delta_abs" DECIMAL(14,2),
    "delta_pct" DOUBLE PRECISION,
    "explanation" TEXT,
    "evidence_jsonb" JSONB NOT NULL DEFAULT '{}',
    "materiality_score" DOUBLE PRECISION NOT NULL,
    "materiality_factors_jsonb" JSONB NOT NULL DEFAULT '{}',
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "superseded_at" TIMESTAMPTZ(6),
    CONSTRAINT "program_element_delta_pkey" PRIMARY KEY ("id")
);

-- Compound natural-key index (queryable; NOT unique here — superseded rows repeat the key).
CREATE INDEX "program_element_delta_natural_key_idx" ON "program_element_delta" ("pe_code", "asserted_fy", "delta_type", "from_ref", "to_ref");
CREATE INDEX "program_element_delta_pe_fy_idx" ON "program_element_delta" ("pe_code", "asserted_fy");
CREATE INDEX "program_element_delta_type_idx" ON "program_element_delta" ("delta_type");
CREATE INDEX "program_element_delta_score_idx" ON "program_element_delta" ("materiality_score" DESC);
CREATE INDEX "program_element_delta_superseded_idx" ON "program_element_delta" ("superseded_at");

-- Latest-wins uniqueness: at most ONE LIVE delta (superseded_at IS NULL) per natural
-- key. Partial + functional (COALESCE collapses the nullable from/to refs to a sentinel
-- so two NULL refs are treated as equal — Postgres otherwise treats NULLs as distinct in
-- unique indexes). Prisma 5 cannot express this, so it is hand-written here.
CREATE UNIQUE INDEX "program_element_delta_live_natural_key"
    ON "program_element_delta" (
        "pe_code",
        "asserted_fy",
        "delta_type",
        COALESCE("from_ref", ''),
        COALESCE("to_ref", '')
    )
    WHERE "superseded_at" IS NULL;

-- FK to the PE (cascade: a retired/removed PE drops its deltas).
ALTER TABLE "program_element_delta"
    ADD CONSTRAINT "program_element_delta_pe_code_fkey"
    FOREIGN KEY ("pe_code") REFERENCES "program_element"("pe_code") ON DELETE CASCADE ON UPDATE CASCADE;
