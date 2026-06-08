-- Step 2.3 — Client relevance inputs: government identifiers, multi-PE capabilities,
-- and client facilities (for district-nexus relevance). client_facilities is TENANT-SCOPED
-- with RLS, mirroring client_people. Purely additive: no existing rows altered.

-- Client: government identifiers + code arrays for procurement matching.
ALTER TABLE "clients" ADD COLUMN "uei" VARCHAR(12);
ALTER TABLE "clients" ADD COLUMN "cage_code" VARCHAR(5);
ALTER TABLE "clients" ADD COLUMN "naics_codes" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "clients" ADD COLUMN "psc_codes" TEXT[] NOT NULL DEFAULT '{}';

-- ClientCapability: multi-PE + explicit match keywords (keep pe_number for backcompat).
ALTER TABLE "client_capabilities" ADD COLUMN "pe_numbers" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "client_capabilities" ADD COLUMN "keywords" TEXT[] NOT NULL DEFAULT '{}';

-- client_facilities (tenant-scoped, RLS like client_people).
CREATE TABLE "client_facilities" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address_line" TEXT,
    "city" TEXT,
    "state" VARCHAR(2),
    "zip" VARCHAR(10),
    "congressional_district" VARCHAR(2),
    "district_source" VARCHAR(16),
    "employee_count" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "client_facilities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_facilities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "client_facilities_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "client_facilities_tenant_idx" ON "client_facilities" ("tenant_id");
CREATE INDEX "client_facilities_tenant_client_idx" ON "client_facilities" ("tenant_id", "client_id");
CREATE INDEX "client_facilities_district_idx" ON "client_facilities" ("state", "congressional_district");

ALTER TABLE "client_facilities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_facilities" FORCE ROW LEVEL SECURITY;
CREATE POLICY "client_facilities_isolation" ON "client_facilities"
    USING (rls_bypass() OR tenant_id = current_tenant_id())
    WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
