-- Capiro identity / tenancy core, migration 0001.
-- Creates tenants, users, tenant_memberships, clerk_events, audit_logs and
-- the Row-Level Security policies that enforce tenant isolation.
--
-- The `app.current_tenant` GUC is set by the API's TenantContextMiddleware
-- via SET LOCAL inside a per-request transaction. RLS policies require the
-- GUC to match tenant_id; queries that forget to set it return zero rows.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
CREATE TYPE "tenant_role" AS ENUM (
  'capiro_admin',
  'client_admin',
  'standard_user',
  'client_portal_user'
);

CREATE TYPE "tenant_status" AS ENUM ('active', 'suspended', 'pending');

CREATE TYPE "membership_status" AS ENUM ('invited', 'active', 'removed');

-- ----------------------------------------------------------------------------
-- updated_at trigger helper
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- tenants
-- ----------------------------------------------------------------------------
CREATE TABLE "tenants" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "slug" CITEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "tenant_status" NOT NULL DEFAULT 'pending',
  "plan" TEXT,
  "settings_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "kms_key_arn" TEXT,
  "soc2_audit_window" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" ("slug");

CREATE TRIGGER "tenants_set_updated_at"
  BEFORE UPDATE ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- users (NOT tenant-scoped — a single Clerk identity may belong to many tenants)
-- ----------------------------------------------------------------------------
CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "clerk_user_id" TEXT NOT NULL,
  "email" CITEXT NOT NULL,
  "first_name" TEXT,
  "last_name" TEXT,
  "last_seen_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_clerk_user_id_key" ON "users" ("clerk_user_id");
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");

CREATE TRIGGER "users_set_updated_at"
  BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- tenant_memberships (tenant-scoped)
-- ----------------------------------------------------------------------------
CREATE TABLE "tenant_memberships" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "tenant_role" NOT NULL,
  "status" "membership_status" NOT NULL DEFAULT 'invited',
  "invited_by" UUID,
  "joined_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "tenant_memberships_tenant_user_unique"
  ON "tenant_memberships" ("tenant_id", "user_id");
CREATE INDEX "tenant_memberships_tenant_role_idx"
  ON "tenant_memberships" ("tenant_id", "role");
CREATE INDEX "tenant_memberships_user_idx" ON "tenant_memberships" ("user_id");

CREATE TRIGGER "tenant_memberships_set_updated_at"
  BEFORE UPDATE ON "tenant_memberships"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- clerk_events (NOT tenant-scoped — webhook landing zone, observability)
-- ----------------------------------------------------------------------------
CREATE TABLE "clerk_events" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload_jsonb" JSONB NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "processed_at" TIMESTAMPTZ(6),
  "error" TEXT,
  CONSTRAINT "clerk_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clerk_events_event_id_key" ON "clerk_events" ("event_id");
CREATE INDEX "clerk_events_event_type_idx" ON "clerk_events" ("event_type");

-- ----------------------------------------------------------------------------
-- audit_logs (tenant-scoped)
-- The arch doc calls for monthly partitioning; partitioning DDL lands in the
-- migration where we cross the volume threshold. For now we keep a single
-- table — the partitioning is a non-breaking forward-compatible change.
-- ----------------------------------------------------------------------------
CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "actor_role" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "before_jsonb" JSONB,
  "after_jsonb" JSONB,
  "ip" TEXT,
  "user_agent" TEXT,
  "request_id" TEXT,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "audit_logs_tenant_occurred_idx"
  ON "audit_logs" ("tenant_id", "occurred_at" DESC);
CREATE INDEX "audit_logs_tenant_action_idx"
  ON "audit_logs" ("tenant_id", "action");

-- ----------------------------------------------------------------------------
-- Row-Level Security
-- The `app.current_tenant` GUC is read on every query. The middleware sets it
-- with `SET LOCAL` inside a transaction; outside a transaction it is empty,
-- which causes RLS-protected reads to return zero rows. That is the intended
-- fail-closed behavior.
-- ----------------------------------------------------------------------------

-- Helper: returns the current tenant UUID, or NULL if unset / invalid.
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
DECLARE
  v_raw TEXT := current_setting('app.current_tenant', true);
BEGIN
  IF v_raw IS NULL OR v_raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN v_raw::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper: bypass flag for trusted server-internal contexts (cross-tenant
-- admin work, webhook ingestion, migrations). Set explicitly via
-- `SET LOCAL app.bypass_rls = 'on'`. Off by default.
CREATE OR REPLACE FUNCTION rls_bypass() RETURNS BOOLEAN AS $$
BEGIN
  RETURN current_setting('app.bypass_rls', true) = 'on';
END;
$$ LANGUAGE plpgsql STABLE;

-- tenants: a row is visible if it is the current tenant, or bypass is on.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenants_isolation" ON "tenants"
  USING (rls_bypass() OR id = current_tenant_id())
  WITH CHECK (rls_bypass() OR id = current_tenant_id());

-- tenant_memberships: scoped by tenant_id.
ALTER TABLE "tenant_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_memberships_isolation" ON "tenant_memberships"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

-- audit_logs: scoped by tenant_id.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_isolation" ON "audit_logs"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

-- users: NOT tenant-scoped, but we want to make sure the API can only see
-- users it has a membership relationship with. We enforce this at the query
-- layer (joining via tenant_memberships) rather than via RLS, because users
-- legitimately span tenants. RLS is left disabled on this table.

-- clerk_events: webhook landing zone, written only by the webhook ingestion
-- path which uses bypass. Reads happen from internal tooling.
ALTER TABLE "clerk_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clerk_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clerk_events_bypass_only" ON "clerk_events"
  USING (rls_bypass())
  WITH CHECK (rls_bypass());

-- ----------------------------------------------------------------------------
-- Application role grants. The API connects as `capiro_app` (created in
-- docker/postgres/init/01-extensions.sql for local; created via Secrets
-- Manager-rotated credentials in deployed envs).
-- Grants are intentionally explicit so we never accidentally hand out
-- table-level permissions to a new role.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "tenants",
      "users",
      "tenant_memberships",
      "clerk_events",
      "audit_logs"
    TO capiro_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO capiro_app;
  END IF;
END
$$;
