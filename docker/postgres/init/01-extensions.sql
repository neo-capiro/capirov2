-- Extensions enabled on the cluster at first boot. Aurora has these available too.
-- Keep this list in sync with the production Aurora parameter group.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Application role used by the API. Migrations run as the superuser (capiro),
-- but the API connects as `capiro_app` so RLS BYPASS does NOT apply.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    CREATE ROLE capiro_app LOGIN PASSWORD 'capiro_app';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE capiro TO capiro_app;
GRANT USAGE ON SCHEMA public TO capiro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO capiro_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO capiro_app;
