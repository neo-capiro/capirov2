-- Capiro identity / tenancy core, migration 0003.
--
-- 1. Rename `tenant_role.client_admin` -> `tenant_role.user_admin` to match
--    the product spec terminology ("user admin" = the firm's tenant admin).
--    Postgres ALTER TYPE RENAME VALUE preserves all existing rows.
-- 2. Add brand asset columns to `tenants` so a Capiro Admin or User Admin can
--    upload a custom logo. The actual upload lives in S3 under the per-tenant
--    prefix `tenants/{tenant_id}/branding/...`; this row stores the key.
-- 3. Add `clients` table — the lobbying firm's customers (their book of
--    business). Tenant-scoped via RLS, intake fields per arch §4.2 with a
--    JSONB column so the form can grow without a migration each time.

-- ----------------------------------------------------------------------------
-- 1. Role rename
-- ----------------------------------------------------------------------------
ALTER TYPE "tenant_role" RENAME VALUE 'client_admin' TO 'user_admin';

-- ----------------------------------------------------------------------------
-- 2. Tenant brand assets
-- ----------------------------------------------------------------------------
ALTER TABLE "tenants" ADD COLUMN "logo_s3_key" TEXT;
ALTER TABLE "tenants" ADD COLUMN "logo_content_type" TEXT;
ALTER TABLE "tenants" ADD COLUMN "logo_uploaded_at" TIMESTAMPTZ(6);

-- ----------------------------------------------------------------------------
-- 3. clients (firm's book of business)
-- ----------------------------------------------------------------------------
CREATE TABLE "clients" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "website" TEXT,
  "description" TEXT,
  "product_description" TEXT,
  "primary_contact_name" TEXT,
  "primary_contact_email" CITEXT,
  "primary_contact_phone" TEXT,
  -- Free-form intake fields. The form starts small and grows; storing the
  -- extras here avoids a column-add migration on every UI iteration.
  "intake_data_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "clients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clients_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clients_created_by_fkey" FOREIGN KEY ("created_by_user_id")
    REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "clients_tenant_idx" ON "clients" ("tenant_id");
CREATE INDEX "clients_tenant_name_idx" ON "clients" ("tenant_id", "name");

CREATE TRIGGER "clients_set_updated_at"
  BEFORE UPDATE ON "clients"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clients_isolation" ON "clients"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

-- Grant the application role the same DML scope as other tenant tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "clients" TO capiro_app;
  END IF;
END
$$;
