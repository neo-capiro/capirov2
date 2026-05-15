-- CreateEnum
CREATE TYPE "workflow_status" AS ENUM ('triage', 'in_progress', 'review', 'submitted', 'complete', 'cancelled');

-- CreateTable
CREATE TABLE "workflow_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'authorization',
    "required_sections_jsonb" JSONB NOT NULL DEFAULT '[]',
    "context_info_jsonb" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_instances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "client_id" UUID,
    "title" TEXT NOT NULL,
    "status" "workflow_status" NOT NULL DEFAULT 'triage',
    "form_data_jsonb" JSONB NOT NULL DEFAULT '{}',
    "target_member_id" TEXT,
    "submission_deadline" DATE,
    "submission_method" TEXT,
    "notes" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_templates_slug_key" ON "workflow_templates"("slug");

-- CreateIndex
CREATE INDEX "workflow_instances_tenant_status_created_idx" ON "workflow_instances"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "workflow_instances_tenant_client_status_idx" ON "workflow_instances"("tenant_id", "client_id", "status");

-- CreateIndex
CREATE INDEX "workflow_instances_tenant_template_idx" ON "workflow_instances"("tenant_id", "template_id");

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
