-- Clio agent workspace tables: sessions, messages, artifacts.
--
-- Tenant-scoped, FORCE ROW LEVEL SECURITY, identical isolation policy
-- to the rest of the schema (rls_bypass() OR tenant_id = current_tenant_id()).
-- All three tables go through capiro_app at runtime — the GRANT block at
-- the bottom mirrors the existing convention from outreach_templates.

CREATE TYPE "clio_session_status" AS ENUM ('active', 'archived', 'deleted');
CREATE TYPE "clio_message_role" AS ENUM ('user', 'assistant', 'system', 'tool');
CREATE TYPE "clio_artifact_kind" AS ENUM (
  'policy_memo',
  'meeting_brief',
  'client_intel_update',
  'regulatory_comment',
  'appropriations_request',
  'other'
);

-- ---------------------------------------------------------------------------
-- clio_sessions

CREATE TABLE "clio_sessions" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" "clio_session_status" NOT NULL DEFAULT 'active',
  "settings_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "last_message_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "clio_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_sessions_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_sessions_user_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_sessions_title_check"
    CHECK (length(trim("title")) > 0),
  CONSTRAINT "clio_sessions_model_check"
    CHECK (length(trim("model")) > 0)
);

CREATE INDEX "clio_sessions_tenant_user_status_idx"
  ON "clio_sessions" ("tenant_id", "user_id", "status", "last_message_at" DESC);

CREATE TRIGGER "clio_sessions_set_updated_at"
  BEFORE UPDATE ON "clio_sessions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "clio_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_sessions_isolation" ON "clio_sessions"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- clio_messages

CREATE TABLE "clio_messages" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "session_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "role" "clio_message_role" NOT NULL,
  "content" TEXT,
  "content_jsonb" JSONB,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "stop_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "clio_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_messages_session_fkey" FOREIGN KEY ("session_id")
    REFERENCES "clio_sessions"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_messages_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_messages_content_check"
    CHECK (
      ("content" IS NOT NULL AND length(trim("content")) > 0)
      OR "content_jsonb" IS NOT NULL
    ),
  CONSTRAINT "clio_messages_tokens_check"
    CHECK (
      ("input_tokens" IS NULL OR "input_tokens" >= 0)
      AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
    )
);

CREATE INDEX "clio_messages_session_created_idx"
  ON "clio_messages" ("session_id", "created_at");
CREATE INDEX "clio_messages_tenant_created_idx"
  ON "clio_messages" ("tenant_id", "created_at" DESC);

ALTER TABLE "clio_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_messages_isolation" ON "clio_messages"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- clio_artifacts

CREATE TABLE "clio_artifacts" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "session_id" UUID,
  "created_by_user_id" UUID,
  "kind" "clio_artifact_kind" NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT,
  "s3_key" TEXT,
  "s3_content_type" TEXT,
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "clio_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_artifacts_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_artifacts_session_fkey" FOREIGN KEY ("session_id")
    REFERENCES "clio_sessions"("id") ON DELETE SET NULL,
  CONSTRAINT "clio_artifacts_creator_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "clio_artifacts_title_check"
    CHECK (length(trim("title")) > 0)
);

CREATE INDEX "clio_artifacts_tenant_kind_updated_idx"
  ON "clio_artifacts" ("tenant_id", "kind", "updated_at" DESC);
CREATE INDEX "clio_artifacts_session_created_idx"
  ON "clio_artifacts" ("session_id", "created_at" DESC);

CREATE TRIGGER "clio_artifacts_set_updated_at"
  BEFORE UPDATE ON "clio_artifacts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "clio_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_artifacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_artifacts_isolation" ON "clio_artifacts"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------------
-- Grants for capiro_app runtime role.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "clio_sessions" TO capiro_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "clio_messages" TO capiro_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "clio_artifacts" TO capiro_app;
  END IF;
END
$$;
