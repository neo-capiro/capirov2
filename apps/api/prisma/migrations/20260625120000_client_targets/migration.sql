-- Client Targets: congressional offices a team intends to engage for a client.
-- Firm-wide per client (tenant-scoped, RLS). Mirrors client_facilities.
CREATE TABLE "client_targets" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "member_id" TEXT NOT NULL,
  "member_name" TEXT,
  "party" VARCHAR(1),
  "state" VARCHAR(8),
  "chamber" VARCHAR(16),
  "committee" TEXT,
  "source" VARCHAR(8) NOT NULL DEFAULT 'manual',
  "added_by_user_id" UUID,
  "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "client_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "client_targets_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "client_targets_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE CASCADE,
  CONSTRAINT "client_targets_added_by_fkey" FOREIGN KEY ("added_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "client_targets_source_check"
    CHECK ("source" IN ('manual', 'meri'))
);

-- Duplicate prevention: a member can be a target for a client only once.
CREATE UNIQUE INDEX "client_targets_client_member_key"
  ON "client_targets" ("client_id", "member_id");
CREATE INDEX "client_targets_tenant_client_idx"
  ON "client_targets" ("tenant_id", "client_id");

ALTER TABLE "client_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_targets" FORCE ROW LEVEL SECURITY;
CREATE POLICY "client_targets_isolation" ON "client_targets"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "client_targets" TO capiro_app;
  END IF;
END
$$;
