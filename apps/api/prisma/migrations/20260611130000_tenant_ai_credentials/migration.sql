-- Per-tenant AI provider keys (per-tenant AI keys & spend, phase 2).
--
-- tenant_ai_credentials: one row per (tenant, provider) holding the tenant's
-- own AI key, AES-256-GCM encrypted at rest with AI_CREDENTIAL_ENCRYPTION_KEY
-- (ciphertext / iv / auth-tag / key-version columns — same envelope pattern
-- as engagement_connection_tokens). key_last4 is the only displayable
-- fragment; the API never returns the plaintext key. model_override lets a
-- tenant pin a specific model when using their own key.
--
-- RLS: tenant-isolated, fail-closed, matching sibling tenant tables.
-- Policy functions current_tenant_id() / rls_bypass() are defined in
-- 20260501000000_init_identity_tenancy.

CREATE TABLE "tenant_ai_credentials" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "key_ciphertext" TEXT NOT NULL,
    "key_iv" TEXT NOT NULL,
    "key_auth_tag" TEXT NOT NULL,
    "key_version" TEXT NOT NULL DEFAULT 'v1',
    "key_last4" VARCHAR(4) NOT NULL,
    "model_override" VARCHAR(80),
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "last_validated_at" TIMESTAMPTZ(6),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "tenant_ai_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenant_ai_credentials_tenant_fkey" FOREIGN KEY ("tenant_id")
        REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "tenant_ai_credentials_tenant_provider_key"
    ON "tenant_ai_credentials" ("tenant_id", "provider");

ALTER TABLE "tenant_ai_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_ai_credentials" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_ai_credentials_isolation" ON "tenant_ai_credentials"
    USING (rls_bypass() OR tenant_id = current_tenant_id())
    WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
