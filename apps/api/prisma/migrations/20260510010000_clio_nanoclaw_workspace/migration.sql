-- Clio workspace persistence.
--
-- These tables are tenant-scoped and user-scoped. The API derives tenant/user
-- from the authenticated Capiro request; callers never provide either value.

CREATE TABLE "clio_conversations" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "client_id" UUID,
  "workspace_key" TEXT NOT NULL DEFAULT 'workspace',
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "nanoclaw_platform_id" TEXT,
  "nanoclaw_agent_group_id" TEXT,
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "archived_at" TIMESTAMPTZ(6),
  CONSTRAINT "clio_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_conversations_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_conversations_client_id_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL
);

CREATE INDEX "clio_conversations_tenant_user_updated_idx"
  ON "clio_conversations" ("tenant_id", "user_id", "updated_at" DESC);
CREATE INDEX "clio_conversations_tenant_client_updated_idx"
  ON "clio_conversations" ("tenant_id", "client_id", "updated_at" DESC);

CREATE TRIGGER "clio_conversations_set_updated_at"
  BEFORE UPDATE ON "clio_conversations"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE "clio_messages" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "client_id" UUID,
  "conversation_id" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "nanoclaw_id" TEXT,
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "clio_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_messages_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_messages_client_id_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "clio_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id")
    REFERENCES "clio_conversations"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_messages_role_check" CHECK ("role" IN ('user', 'assistant', 'tool', 'system'))
);

CREATE INDEX "clio_messages_tenant_user_created_idx"
  ON "clio_messages" ("tenant_id", "user_id", "created_at");
CREATE INDEX "clio_messages_tenant_client_created_idx"
  ON "clio_messages" ("tenant_id", "client_id", "created_at");
CREATE INDEX "clio_messages_conversation_created_idx"
  ON "clio_messages" ("conversation_id", "created_at");

CREATE TABLE "clio_artifacts" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "client_id" UUID,
  "conversation_id" UUID NOT NULL,
  "message_id" UUID,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "content_type" TEXT,
  "body_text" TEXT,
  "s3_key" TEXT,
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "clio_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_artifacts_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_artifacts_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_artifacts_client_id_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "clio_artifacts_conversation_id_fkey" FOREIGN KEY ("conversation_id")
    REFERENCES "clio_conversations"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_artifacts_message_id_fkey" FOREIGN KEY ("message_id")
    REFERENCES "clio_messages"("id") ON DELETE SET NULL
);

CREATE INDEX "clio_artifacts_tenant_user_created_idx"
  ON "clio_artifacts" ("tenant_id", "user_id", "created_at" DESC);
CREATE INDEX "clio_artifacts_tenant_client_created_idx"
  ON "clio_artifacts" ("tenant_id", "client_id", "created_at" DESC);
CREATE INDEX "clio_artifacts_conversation_created_idx"
  ON "clio_artifacts" ("conversation_id", "created_at" DESC);

CREATE TRIGGER "clio_artifacts_set_updated_at"
  BEFORE UPDATE ON "clio_artifacts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "clio_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_conversations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_conversations_isolation" ON "clio_conversations"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "clio_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_messages_isolation" ON "clio_messages"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "clio_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_artifacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_artifacts_isolation" ON "clio_artifacts"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "clio_conversations",
      "clio_messages",
      "clio_artifacts"
    TO capiro_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO capiro_app;
  END IF;
END
$$;
