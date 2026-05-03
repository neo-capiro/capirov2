CREATE TABLE "directory_contact_notes" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "directory_contact_id" TEXT NOT NULL,
  "directory_contact_name" TEXT,
  "body" TEXT NOT NULL,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "directory_contact_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "directory_contact_notes_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "directory_contact_notes_created_by_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "directory_contact_notes_tenant_contact_created_idx"
  ON "directory_contact_notes" ("tenant_id", "directory_contact_id", "created_at" DESC);
CREATE INDEX "directory_contact_notes_created_by_idx"
  ON "directory_contact_notes" ("created_by_user_id");

CREATE TRIGGER "directory_contact_notes_set_updated_at"
  BEFORE UPDATE ON "directory_contact_notes"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "directory_contact_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "directory_contact_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "directory_contact_notes_isolation" ON "directory_contact_notes"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "directory_contact_notes" TO capiro_app;
  END IF;
END
$$;
