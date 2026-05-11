CREATE TYPE "clio_artifact_kind" AS ENUM (
  'policy_memo',
  'meeting_brief',
  'client_intel_update',
  'regulatory_comment',
  'appropriations_request',
  'other'
);

CREATE TABLE "clio_artifacts" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "created_by_user_id" UUID,
  "kind" "clio_artifact_kind" NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT,
  "s3_key" TEXT,
  "s3_content_type" TEXT,
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "clio_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_artifacts_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "clio_artifacts_creator_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "clio_artifacts_tenant_kind_updated_idx"
  ON "clio_artifacts" ("tenant_id", "kind", "updated_at" DESC);
CREATE INDEX "clio_artifacts_tenant_user_created_idx"
  ON "clio_artifacts" ("tenant_id", "created_by_user_id", "created_at" DESC);

ALTER TABLE "clio_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_artifacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_artifacts_isolation" ON "clio_artifacts"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

