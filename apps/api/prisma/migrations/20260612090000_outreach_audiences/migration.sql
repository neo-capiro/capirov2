-- Outreach 2.0: saved, reusable contact lists/groups (design doc
-- 2026-06-11_outreach-2.0-data-model.md, migration plan step 1).
-- User-owned (created_by_user_id), tenant-scoped, FORCE RLS like every
-- other tenant table. kind: 'list' = each member gets their own 1:1 email;
-- 'group' = one shared email to all members.

-- CreateTable
CREATE TABLE "outreach_audiences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "outreach_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_audience_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "audience_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "source_ref_id" TEXT,
    "name" TEXT,
    "email" CITEXT NOT NULL,
    "title" TEXT,
    "office" TEXT,
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "outreach_audience_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outreach_audiences_tenant_user_kind_name_idx" ON "outreach_audiences"("tenant_id", "created_by_user_id", "kind", "name");

-- CreateIndex
CREATE INDEX "outreach_audience_members_tenant_audience_idx" ON "outreach_audience_members"("tenant_id", "audience_id");

-- AddForeignKey
ALTER TABLE "outreach_audiences" ADD CONSTRAINT "outreach_audiences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_audience_members" ADD CONSTRAINT "outreach_audience_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_audience_members" ADD CONSTRAINT "outreach_audience_members_audience_id_fkey" FOREIGN KEY ("audience_id") REFERENCES "outreach_audiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row level security (tenant isolation, forced like all tenant tables)
ALTER TABLE "outreach_audiences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_audiences" FORCE ROW LEVEL SECURITY;
CREATE POLICY "outreach_audiences_isolation" ON "outreach_audiences"
    USING (rls_bypass() OR tenant_id = current_tenant_id())
    WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

ALTER TABLE "outreach_audience_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_audience_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY "outreach_audience_members_isolation" ON "outreach_audience_members"
    USING (rls_bypass() OR tenant_id = current_tenant_id())
    WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
