ALTER TABLE "outreach_records"
  DROP CONSTRAINT IF EXISTS "outreach_records_type_check";

ALTER TABLE "outreach_records"
  ADD CONSTRAINT "outreach_records_type_check"
  CHECK ("type" IN ('campaign', 'follow_up', 'prep', 'outbound_campaign'));

CREATE TABLE "outreach_templates" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "created_by_user_id" UUID,
  "type" TEXT NOT NULL DEFAULT 'outbound_campaign',
  "name" TEXT NOT NULL,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "outreach_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outreach_templates_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "outreach_templates_created_by_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "outreach_templates_type_check"
    CHECK ("type" IN ('outbound_campaign')),
  CONSTRAINT "outreach_templates_name_check"
    CHECK (length(trim("name")) > 0),
  CONSTRAINT "outreach_templates_body_check"
    CHECK (length(trim("body")) > 0)
);

CREATE INDEX "outreach_templates_tenant_user_type_updated_idx"
  ON "outreach_templates" ("tenant_id", "created_by_user_id", "type", "updated_at" DESC);

CREATE TRIGGER "outreach_templates_set_updated_at"
  BEFORE UPDATE ON "outreach_templates"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "outreach_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY "outreach_templates_isolation" ON "outreach_templates"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "outreach_templates" TO capiro_app;
  END IF;
END
$$;
