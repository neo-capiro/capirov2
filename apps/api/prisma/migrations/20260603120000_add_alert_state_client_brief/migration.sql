-- Per-user worklist state for the client-profile "Top alerts" surface.
-- TENANT-scoped with RLS (mirrors the tracked_bill / engagement_* isolation
-- policy). Keyed by (user_id, client_id, alert_id) so dismiss/snooze/acknowledge
-- is per-user. alert_id is the stable composite the alerts builder emits, e.g.
-- 'comment:<docId>', 'hearing:<id>', 'bill:<billId>', 'change:<id>',
-- 'award:<id>', 'competitor:<filingId>', 'comment_overdue:<docId>'.
CREATE TABLE IF NOT EXISTS "alert_state" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "alert_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "snoozed_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "alert_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "alert_state_user_id_client_id_alert_id_key"
    ON "alert_state" ("user_id", "client_id", "alert_id");
CREATE INDEX IF NOT EXISTS "alert_state_tenant_id_idx" ON "alert_state" ("tenant_id");
CREATE INDEX IF NOT EXISTS "alert_state_client_id_idx" ON "alert_state" ("client_id");
CREATE INDEX IF NOT EXISTS "alert_state_user_id_idx" ON "alert_state" ("user_id");

ALTER TABLE "alert_state" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "alert_state" FORCE ROW LEVEL SECURITY;
CREATE POLICY "alert_state_isolation" ON "alert_state"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

-- Saved "client brief" notes. A lobbyist promotes an alert (or writes a
-- free-form note) into the client's brief; all briefs surface in the Outreach
-- wizard's context section. TENANT-scoped with RLS.
CREATE TABLE IF NOT EXISTS "client_brief" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "created_by" TEXT,
    "source_alert_id" TEXT,
    "source_type" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "client_brief_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "client_brief_tenant_id_idx" ON "client_brief" ("tenant_id");
CREATE INDEX IF NOT EXISTS "client_brief_client_id_idx" ON "client_brief" ("client_id");

ALTER TABLE "client_brief" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_brief" FORCE ROW LEVEL SECURITY;
CREATE POLICY "client_brief_isolation" ON "client_brief"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
