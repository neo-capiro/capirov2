-- CreateTable
CREATE TABLE "client_capabilities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'product',
    "description" TEXT,
    "sector" TEXT,
    "tags_jsonb" JSONB NOT NULL DEFAULT '[]',
    "trl" INTEGER,
    "mrl" INTEGER,
    "pe_number" TEXT,
    "appropriation_account" TEXT,
    "service_branch" TEXT,
    "target_subcommittee" TEXT,
    "funding_ask" INTEGER,
    "funding_ask_label" TEXT,
    "justification" TEXT,
    "district_nexus" TEXT,
    "existing_contracts" TEXT,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_submission_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "capability_id" UUID,
    "fiscal_year" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "meta" TEXT,
    "outcome" TEXT,
    "outcome_type" TEXT NOT NULL DEFAULT 'in_progress',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_submission_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_people" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" CITEXT,
    "phone" TEXT,
    "role" TEXT,
    "last_contact" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_people_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_capabilities_tenant_client_idx" ON "client_capabilities"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "client_submission_history_tenant_client_cap_idx" ON "client_submission_history"("tenant_id", "client_id", "capability_id");

-- CreateIndex
CREATE INDEX "client_people_tenant_client_idx" ON "client_people"("tenant_id", "client_id");

-- AddForeignKey
ALTER TABLE "client_capabilities" ADD CONSTRAINT "client_capabilities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_capabilities" ADD CONSTRAINT "client_capabilities_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_submission_history" ADD CONSTRAINT "client_submission_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_submission_history" ADD CONSTRAINT "client_submission_history_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_submission_history" ADD CONSTRAINT "client_submission_history_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "client_capabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_people" ADD CONSTRAINT "client_people_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_people" ADD CONSTRAINT "client_people_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
