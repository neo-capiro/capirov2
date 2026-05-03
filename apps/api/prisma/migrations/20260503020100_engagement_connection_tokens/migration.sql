-- Encrypted OAuth tokens for engagement provider connections.
-- Tokens are AES-256-GCM ciphertext at rest; the symmetric key is rotated
-- per environment via OAUTH_TOKEN_ENCRYPTION_KEY[+_VERSION].

CREATE TABLE "engagement_connection_tokens" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "access_token_ciphertext" TEXT NOT NULL,
  "access_token_iv" TEXT NOT NULL,
  "access_token_auth_tag" TEXT NOT NULL,
  "refresh_token_ciphertext" TEXT,
  "refresh_token_iv" TEXT,
  "refresh_token_auth_tag" TEXT,
  "key_version" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "home_account_id" TEXT,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "engagement_connection_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "engagement_connection_tokens_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "engagement_connection_tokens_connection_fkey" FOREIGN KEY ("connection_id")
    REFERENCES "engagement_connections"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "engagement_connection_tokens_connection_key"
  ON "engagement_connection_tokens" ("connection_id");
CREATE INDEX "engagement_connection_tokens_tenant_connection_idx"
  ON "engagement_connection_tokens" ("tenant_id", "connection_id");

CREATE TRIGGER "engagement_connection_tokens_set_updated_at"
  BEFORE UPDATE ON "engagement_connection_tokens"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "engagement_connection_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_connection_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY "engagement_connection_tokens_isolation" ON "engagement_connection_tokens"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
