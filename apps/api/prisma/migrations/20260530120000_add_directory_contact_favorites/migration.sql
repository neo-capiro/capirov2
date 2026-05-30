CREATE TABLE "directory_contact_favorites" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "directory_contact_id" TEXT NOT NULL,
  "directory_contact_name" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "directory_contact_favorites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "directory_contact_favorites_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "directory_contact_favorites_user_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "directory_contact_favorites_unique"
  ON "directory_contact_favorites" ("tenant_id", "user_id", "directory_contact_id");
CREATE INDEX "directory_contact_favorites_tenant_user_idx"
  ON "directory_contact_favorites" ("tenant_id", "user_id");

ALTER TABLE "directory_contact_favorites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "directory_contact_favorites" FORCE ROW LEVEL SECURITY;
CREATE POLICY "directory_contact_favorites_isolation" ON "directory_contact_favorites"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "directory_contact_favorites" TO capiro_app;
  END IF;
END
$$;
