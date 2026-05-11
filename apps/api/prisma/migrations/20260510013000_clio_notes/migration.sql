-- User-scoped Clio notes saved from the workspace/tool runtime.

CREATE TABLE "clio_notes" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "client_id" UUID,
  "conversation_id" UUID,
  "meeting_id" UUID,
  "title" TEXT,
  "body" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'clio',
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "clio_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_notes_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_notes_client_id_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "clio_notes_conversation_id_fkey" FOREIGN KEY ("conversation_id")
    REFERENCES "clio_conversations"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_notes_meeting_id_fkey" FOREIGN KEY ("meeting_id")
    REFERENCES "meetings"("id") ON DELETE SET NULL
);

CREATE INDEX "clio_notes_tenant_user_created_idx"
  ON "clio_notes" ("tenant_id", "user_id", "created_at" DESC);
CREATE INDEX "clio_notes_tenant_client_created_idx"
  ON "clio_notes" ("tenant_id", "client_id", "created_at" DESC);
CREATE INDEX "clio_notes_conversation_created_idx"
  ON "clio_notes" ("conversation_id", "created_at" DESC);

CREATE TRIGGER "clio_notes_set_updated_at"
  BEFORE UPDATE ON "clio_notes"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "clio_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_notes_isolation" ON "clio_notes"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "clio_notes" TO capiro_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO capiro_app;
  END IF;
END
$$;
