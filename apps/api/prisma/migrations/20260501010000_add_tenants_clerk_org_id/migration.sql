-- Capiro identity / tenancy core, migration 0002.
-- Links each tenant to a Clerk Organization. The middleware cross-checks the
-- Clerk JWT's `org_id` claim against this column to detect tenant/host
-- mismatches early (architecture doc §2.2 / §8.2).
--
-- Nullable on purpose: existing tenants from migration 0001 may have been
-- provisioned before Organizations were enabled. They are linked when the
-- bootstrap-tenant script is re-run with the same slug.

ALTER TABLE "tenants" ADD COLUMN "clerk_org_id" TEXT;

CREATE UNIQUE INDEX "tenants_clerk_org_id_key" ON "tenants" ("clerk_org_id");
