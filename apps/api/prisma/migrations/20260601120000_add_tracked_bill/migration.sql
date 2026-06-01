-- Manually tracked bills: explicit human decision to follow a specific
-- congress_bill for a client. TENANT-scoped with RLS (mirrors the engagement
-- tables' isolation policy). Distinct from the derived "relevant" bills the
-- Issue-Bill Linker surfaces by embedding similarity.
CREATE TABLE IF NOT EXISTS "tracked_bill" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "bill_id" TEXT NOT NULL,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "tracked_bill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tracked_bill_client_id_bill_id_key"
    ON "tracked_bill" ("client_id", "bill_id");
CREATE INDEX IF NOT EXISTS "tracked_bill_tenant_id_idx" ON "tracked_bill" ("tenant_id");
CREATE INDEX IF NOT EXISTS "tracked_bill_client_id_idx" ON "tracked_bill" ("client_id");
CREATE INDEX IF NOT EXISTS "tracked_bill_bill_id_idx" ON "tracked_bill" ("bill_id");

-- ----------------------------------------------------------------------------
-- Row-Level Security (matches engagement_* isolation policy convention)
-- ----------------------------------------------------------------------------
ALTER TABLE "tracked_bill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tracked_bill" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tracked_bill_isolation" ON "tracked_bill"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
