-- SOC 2 hardening: give client_intel_mapping a tenant_id and force RLS.
--
-- The table was created GLOBAL (no tenant_id, no clients FK) but every row IS
-- tenant-scoped via client_id (a client belongs to exactly one tenant). Without
-- an RLS policy, a read that forgets the tenant scope leaks across tenants. The
-- active cross-tenant IDOR on the mappings endpoints was fixed in code; this is
-- the fail-closed backstop, matching client_facilities / client_capabilities.
--
-- Policy functions current_tenant_id() (reads app.current_tenant) and rls_bypass()
-- (reads app.bypass_rls) are defined in 20260501000000_init_identity_tenancy.

-- 1. Add the column (nullable while we backfill).
ALTER TABLE "client_intel_mapping" ADD COLUMN "tenant_id" UUID;

-- 2. Backfill tenant_id from the owning client.
UPDATE "client_intel_mapping" cim
SET "tenant_id" = c."tenant_id"
FROM "clients" c
WHERE cim."client_id" = c."id";

-- 3. Drop orphan rows: client_id pointing at a client that no longer exists.
--    The table never had a clients FK, so these can accumulate from deleted
--    clients; they are unusable (no client to attach to) and cannot be
--    tenant-scoped, so they must go before SET NOT NULL.
DELETE FROM "client_intel_mapping" WHERE "tenant_id" IS NULL;

-- 4. Enforce NOT NULL + FK to tenants (cascade when a tenant is deleted) + index
--    the RLS predicate column.
ALTER TABLE "client_intel_mapping" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "client_intel_mapping"
  ADD CONSTRAINT "client_intel_mapping_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "client_intel_mapping_tenant_id_idx" ON "client_intel_mapping"("tenant_id");

-- 5. Force RLS with the proven isolation policy.
ALTER TABLE "client_intel_mapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_intel_mapping" FORCE ROW LEVEL SECURITY;
CREATE POLICY "client_intel_mapping_isolation" ON "client_intel_mapping"
    USING (rls_bypass() OR tenant_id = current_tenant_id())
    WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
