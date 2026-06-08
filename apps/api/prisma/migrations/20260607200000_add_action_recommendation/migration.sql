-- Step 3.2 — ActionRecommendation engine: materiality-gated, client-specific action
-- cards (plan §10 card spec, §19 workflow states, §12.4 board). action_recommendation is
-- TENANT-SCOPED with RLS, mirroring client_facilities (§2.3). delta_id / program_id /
-- pe_code / owner_user_id are plain columns (no FK) — matching how the repo stores
-- resolvedByUserId / peCode as plain ids. Purely additive: no existing rows altered.

CREATE TABLE "action_recommendation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "pe_code" VARCHAR(16),
    "program_id" UUID,
    "delta_id" UUID,
    "action_type" VARCHAR(40) NOT NULL,
    "issue_title" TEXT NOT NULL,
    "what_changed" TEXT NOT NULL,
    "why_it_matters" TEXT NOT NULL,
    "recommended_action" TEXT NOT NULL,
    "target_audience_jsonb" JSONB NOT NULL DEFAULT '[]',
    "suggested_artifact_type" VARCHAR(40),
    "deadline" DATE,
    "deadline_source" VARCHAR(24),
    "owner_user_id" UUID,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "confidence_jsonb" JSONB NOT NULL DEFAULT '{}',
    "uncertainty" TEXT,
    "evidence_jsonb" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(24) NOT NULL DEFAULT 'new',
    "dismissal_reason" TEXT,
    "outcome" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "action_recommendation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "action_recommendation_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "action_recommendation_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "action_recommendation_dedupe_key" ON "action_recommendation" ("tenant_id", "client_id", (COALESCE("delta_id"::text, '')), "action_type");
CREATE INDEX "action_recommendation_tenant_status_deadline_idx" ON "action_recommendation" ("tenant_id", "status", "deadline");
CREATE INDEX "action_recommendation_tenant_client_idx" ON "action_recommendation" ("tenant_id", "client_id");

ALTER TABLE "action_recommendation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "action_recommendation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "action_recommendation_isolation" ON "action_recommendation"
    USING (rls_bypass() OR tenant_id = current_tenant_id())
    WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
