-- AlterTable: add strategy_id to workflow_instances
ALTER TABLE "workflow_instances" ADD COLUMN "strategy_id" UUID;

-- CreateTable
CREATE TABLE "strategies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "capability_id" UUID,
    "created_by_user_id" UUID,
    "name" TEXT NOT NULL,
    "fiscal_year" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "submission_types_jsonb" JSONB NOT NULL DEFAULT '[]',
    "settings_jsonb" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_targets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "member_name" TEXT NOT NULL,
    "member_title" TEXT,
    "member_party" TEXT,
    "member_state" TEXT,
    "committee" TEXT,
    "subcommittee" TEXT,
    "staffer_name" TEXT,
    "staffer_email" TEXT,
    "directory_contact_id" TEXT,
    "outreach_status" TEXT NOT NULL DEFAULT 'not_started',
    "meeting_date" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "strategy_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strategies_tenant_client_status_idx" ON "strategies"("tenant_id", "client_id", "status");

-- CreateIndex
CREATE INDEX "strategy_targets_tenant_strategy_idx" ON "strategy_targets"("tenant_id", "strategy_id");

-- CreateIndex
CREATE INDEX "workflow_instances_strategy_idx" ON "workflow_instances"("strategy_id");

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_capability_id_fkey" FOREIGN KEY ("capability_id") REFERENCES "client_capabilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_targets" ADD CONSTRAINT "strategy_targets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_targets" ADD CONSTRAINT "strategy_targets_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
