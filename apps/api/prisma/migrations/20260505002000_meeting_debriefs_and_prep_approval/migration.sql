ALTER TYPE "meeting_prep_status" ADD VALUE IF NOT EXISTS 'approved';

CREATE TABLE "meeting_debriefs" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "meeting_id" UUID NOT NULL,
  "client_id" UUID,
  "author_user_id" UUID,
  "body_ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "auth_tag" TEXT NOT NULL,
  "key_version" TEXT,
  "confidential" BOOLEAN NOT NULL DEFAULT true,
  "access_level" TEXT NOT NULL DEFAULT 'tenant_members',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "meeting_debriefs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meeting_debriefs_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "meeting_debriefs_meeting_fkey" FOREIGN KEY ("meeting_id")
    REFERENCES "meetings"("id") ON DELETE CASCADE,
  CONSTRAINT "meeting_debriefs_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "meeting_debriefs_author_fkey" FOREIGN KEY ("author_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "meeting_debriefs_tenant_meeting_created_idx"
  ON "meeting_debriefs" ("tenant_id", "meeting_id", "created_at");

CREATE TRIGGER "meeting_debriefs_set_updated_at"
  BEFORE UPDATE ON "meeting_debriefs"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "meeting_debriefs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "meeting_debriefs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "meeting_debriefs_isolation" ON "meeting_debriefs"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "meeting_debriefs" TO capiro_app;
  END IF;
END
$$;
