-- SOC 2 hardening: force row-level security on client_capabilities.
--
-- The table already carries tenant_id (20260517175724_add_client_capabilities_people)
-- and the per-request path reads it tenant-scoped via PrismaService.withTenant, but
-- without an RLS policy a read that forgets the tenant scope would leak across tenants
-- (fail-open). This makes it fail-closed, matching client_facilities (20260607190000)
-- and action_recommendation (20260607200000).
--
-- The three genuinely cross-tenant/system readers were converted to the bypass path
-- (withSystem / SET app.bypass_rls) in the same change so they keep working:
--   * delta-engine.service.ts + program-element-writer.service.ts getAffectedTenants
--   * embeddings.service.ts embedCapabilityImmediate (fire-and-forget on-write embed)
--   * scripts/embed-backfill.ts all-tenant capability backfill
-- The strategies.service.ts reads were tightened to withTenant (they always have the
-- tenant in scope), so they stay tenant-isolated rather than bypassing.
--
-- Policy functions current_tenant_id() (reads app.current_tenant) and rls_bypass()
-- (reads app.bypass_rls) are defined in 20260501000000_init_identity_tenancy.

ALTER TABLE "client_capabilities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_capabilities" FORCE ROW LEVEL SECURITY;
CREATE POLICY "client_capabilities_isolation" ON "client_capabilities"
    USING (rls_bypass() OR tenant_id = current_tenant_id())
    WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
