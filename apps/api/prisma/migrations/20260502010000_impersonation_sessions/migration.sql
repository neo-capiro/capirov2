-- Capiro identity / tenancy core, migration 0004.
-- Tracks Capiro Admin impersonation sessions per arch §8.2 ("just-in-time
-- elevation for capiro_admin actions; impersonation requires a reason field,
-- is fully audited, and is read-only by default").
--
-- A capiro_admin starts an impersonation by POSTing /capiro-admin/impersonate
-- with { tenantId, reason }. The middleware checks for an active session for
-- the caller and, if present + matching the x-capiro-impersonate-tenant
-- header, swaps the tenant context. Every request executed under
-- impersonation lands an audit_logs row with actor_role='capiro_admin' and
-- a reason populated.

CREATE TABLE "impersonation_sessions" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "actor_user_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "ended_at" TIMESTAMPTZ(6),
  "ended_reason" TEXT,
  CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "impersonation_sessions_actor_fkey" FOREIGN KEY ("actor_user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "impersonation_sessions_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "impersonation_sessions_actor_active_idx"
  ON "impersonation_sessions" ("actor_user_id", "expires_at")
  WHERE "ended_at" IS NULL;

-- Not tenant-scoped via RLS — the session is owned by the Capiro Admin and
-- the lookup happens before tenant context is established. Reads/writes go
-- through the system path (rls_bypass).
ALTER TABLE "impersonation_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "impersonation_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "impersonation_sessions_bypass_only" ON "impersonation_sessions"
  USING (rls_bypass())
  WITH CHECK (rls_bypass());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "impersonation_sessions" TO capiro_app;
  END IF;
END
$$;
