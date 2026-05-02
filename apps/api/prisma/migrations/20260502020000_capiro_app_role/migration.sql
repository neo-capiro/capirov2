-- Capiro identity / tenancy core, migration 0005.
-- Creates the runtime DB role `capiro_app` with no DDL privileges. The API
-- connects as this role; migrations continue to run as the Aurora master.
--
-- The password is set to a placeholder here. The `bootstrap-roles` ECS task
-- runs after this migration, reads the real password from Secrets Manager,
-- and rotates the role to match. Rotation later happens via the same
-- bootstrap-roles task whenever the secret changes.
--
-- FORCE ROW LEVEL SECURITY on every tenant table already prevents the role
-- from bypassing RLS even though it owns no privileges to do so.

-- The password is a fixed placeholder — the bootstrap-roles task replaces it
-- with the real password from Secrets Manager before the API ever connects.
-- Without an active bootstrap-roles run this role cannot log in (placeholder
-- isn't stored anywhere).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    CREATE ROLE capiro_app LOGIN PASSWORD 'placeholder-rotate-via-bootstrap-roles';
  END IF;
END
$$;

-- Schema-level access. capiro_app can read/write existing AND future tables;
-- the ALTER DEFAULT PRIVILEGES below covers tables yet to be created by the
-- master role (Prisma migrations run as master, so future tables inherit
-- ownership from master and the default privileges grant capiro_app DML).
GRANT CONNECT ON DATABASE capiro TO capiro_app;
GRANT USAGE ON SCHEMA public TO capiro_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO capiro_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO capiro_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO capiro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO capiro_app;

-- The two GUC settings RLS depends on (`app.current_tenant`, `app.bypass_rls`)
-- are session-scoped GUCs; capiro_app reads/writes them via set_config().
-- No GRANT needed because set_config() with `is_local=true` is allowed on
-- any custom GUC name for any role.
