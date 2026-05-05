CREATE TABLE "engagement_report_target_offices" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "client_id" UUID,
  "scope_key" TEXT NOT NULL,
  "office_key" TEXT NOT NULL,
  "member_principal" TEXT NOT NULL,
  "committee" TEXT,
  "staffer" TEXT,
  "building" TEXT,
  "lead_owner" TEXT,
  "prep_status" TEXT NOT NULL DEFAULT 'auto',
  "outreach_status" TEXT NOT NULL DEFAULT 'auto',
  "submission_status" TEXT NOT NULL DEFAULT 'auto',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "engagement_report_target_offices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "engagement_report_targets_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "engagement_report_targets_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "engagement_report_targets_created_by_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "engagement_report_targets_prep_status_check"
    CHECK ("prep_status" IN ('auto', 'not_started', 'in_progress', 'complete')),
  CONSTRAINT "engagement_report_targets_outreach_status_check"
    CHECK ("outreach_status" IN ('auto', 'not_started', 'in_progress', 'complete')),
  CONSTRAINT "engagement_report_targets_submission_status_check"
    CHECK ("submission_status" IN ('auto', 'not_started', 'in_progress', 'complete'))
);

CREATE UNIQUE INDEX "engagement_report_targets_tenant_scope_office_key"
  ON "engagement_report_target_offices" ("tenant_id", "scope_key", "office_key");
CREATE INDEX "engagement_report_targets_tenant_client_prep_idx"
  ON "engagement_report_target_offices" ("tenant_id", "client_id", "prep_status");

CREATE TRIGGER "engagement_report_target_offices_set_updated_at"
  BEFORE UPDATE ON "engagement_report_target_offices"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "engagement_report_target_offices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "engagement_report_target_offices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "engagement_report_target_offices_isolation" ON "engagement_report_target_offices"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "engagement_report_target_offices" TO capiro_app;
  END IF;
END
$$;
