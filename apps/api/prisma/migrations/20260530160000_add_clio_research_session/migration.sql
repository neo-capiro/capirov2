CREATE TABLE "clio_research_sessions" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "client_id" UUID,
  "title" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'plan',
  "clarifying_questions_jsonb" JSONB NOT NULL DEFAULT '[]',
  "clarifying_answers_jsonb" JSONB NOT NULL DEFAULT '{}',
  "plan" JSONB NOT NULL DEFAULT '[]',
  "sources" JSONB NOT NULL DEFAULT '[]',
  "report_artifact_id" UUID,
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "clio_research_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_research_sessions_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_research_sessions_user_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_research_sessions_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL
);

CREATE INDEX "clio_research_sessions_tenant_user_updated_idx"
  ON "clio_research_sessions" ("tenant_id", "user_id", "updated_at" DESC);
CREATE INDEX "clio_research_sessions_tenant_client_updated_idx"
  ON "clio_research_sessions" ("tenant_id", "client_id", "updated_at" DESC);

ALTER TABLE "clio_research_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_research_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_research_sessions_isolation" ON "clio_research_sessions"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "clio_research_sessions" TO capiro_app;
  END IF;
END
$$;
