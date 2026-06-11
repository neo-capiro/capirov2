-- AI usage metering (per-tenant AI keys & spend, phase 1).
--
-- ai_usage_events: one row per AI generation — tenant, workflow, provider,
-- model, token counts, and the ESTIMATED cost computed from the
-- hand-maintained pricing table (ai-pricing.ts). used_tenant_key marks
-- generations billed to the tenant's own provider key (phase 2) instead of
-- Capiro's shared env key.
--
-- RLS: tenant-isolated, fail-closed, matching sibling tenant tables
-- (clio_mcp_servers et al). Policy functions current_tenant_id() /
-- rls_bypass() are defined in 20260501000000_init_identity_tenancy.

CREATE TABLE "ai_usage_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "workflow" VARCHAR(48) NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_usd" DECIMAL(12,6) NOT NULL,
    "used_tenant_key" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_usage_events_tenant_fkey" FOREIGN KEY ("tenant_id")
        REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ai_usage_events_tenant_created_idx"
    ON "ai_usage_events" ("tenant_id", "created_at");

ALTER TABLE "ai_usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ai_usage_events_isolation" ON "ai_usage_events"
    USING (rls_bypass() OR tenant_id = current_tenant_id())
    WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
