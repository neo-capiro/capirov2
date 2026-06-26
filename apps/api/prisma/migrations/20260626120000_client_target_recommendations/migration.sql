-- Persisted Office Recommender ("Suggested by Meri") output for a client's
-- Targets tab. Computing recommendations is slow (tracked-bill resolution +
-- scoring every office), so we compute once and serve this cache thereafter;
-- a manual "Refresh" recomputes. One row per client (tenant-scoped, RLS).
CREATE TABLE "client_target_recommendations" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "recommendations_jsonb" JSONB NOT NULL DEFAULT '[]',
  "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "client_target_recommendations_pkey" PRIMARY KEY ("id"),
  -- Canonical Prisma FK names (table_column_fkey) + ON UPDATE CASCADE so the
  -- schema model and this migration stay drift-free under relationMode=foreignKeys.
  CONSTRAINT "client_target_recommendations_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "client_target_recommendations_client_id_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One cache row per client.
CREATE UNIQUE INDEX "client_target_recommendations_client_key"
  ON "client_target_recommendations" ("client_id");
CREATE INDEX "client_target_recommendations_tenant_client_idx"
  ON "client_target_recommendations" ("tenant_id", "client_id");

ALTER TABLE "client_target_recommendations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_target_recommendations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "client_target_recommendations_isolation" ON "client_target_recommendations"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "client_target_recommendations" TO capiro_app;
  END IF;
END
$$;
