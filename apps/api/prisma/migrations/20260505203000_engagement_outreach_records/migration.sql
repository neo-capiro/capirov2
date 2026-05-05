CREATE TABLE "outreach_records" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "client_id" UUID,
  "meeting_id" UUID,
  "created_by_user_id" UUID,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "title" TEXT NOT NULL,
  "subject" TEXT,
  "body" TEXT,
  "recipients_jsonb" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "recipient_count" INTEGER NOT NULL DEFAULT 0,
  "stats_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "last_step" INTEGER NOT NULL DEFAULT 1,
  "sent_at" TIMESTAMPTZ(6),
  "opened_in_email_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "outreach_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outreach_records_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "outreach_records_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "outreach_records_meeting_fkey" FOREIGN KEY ("meeting_id")
    REFERENCES "meetings"("id") ON DELETE SET NULL,
  CONSTRAINT "outreach_records_created_by_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "outreach_records_type_check"
    CHECK ("type" IN ('campaign', 'follow_up', 'prep')),
  CONSTRAINT "outreach_records_status_check"
    CHECK ("status" IN ('draft', 'sent', 'opened_in_email', 'failed')),
  CONSTRAINT "outreach_records_last_step_check"
    CHECK ("last_step" >= 1 AND "last_step" <= 5),
  CONSTRAINT "outreach_records_recipient_count_check"
    CHECK ("recipient_count" >= 0)
);

CREATE INDEX "outreach_records_tenant_type_status_created_idx"
  ON "outreach_records" ("tenant_id", "type", "status", "created_at" DESC);
CREATE INDEX "outreach_records_tenant_client_created_idx"
  ON "outreach_records" ("tenant_id", "client_id", "created_at" DESC);
CREATE INDEX "outreach_records_tenant_meeting_idx"
  ON "outreach_records" ("tenant_id", "meeting_id");

CREATE TRIGGER "outreach_records_set_updated_at"
  BEFORE UPDATE ON "outreach_records"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "outreach_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY "outreach_records_isolation" ON "outreach_records"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "outreach_records" TO capiro_app;
  END IF;
END
$$;
