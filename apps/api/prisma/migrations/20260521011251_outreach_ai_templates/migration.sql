-- CreateTable
CREATE TABLE "outreach_ai_template" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "prompt" TEXT NOT NULL,
    "description" TEXT,
    "sample_preview" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'professional',
    "metadata_jsonb" JSONB,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_ai_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outreach_ai_templates_tenant_user_cat_idx" ON "outreach_ai_template"("tenant_id", "user_id", "category", "updated_at");

-- AddForeignKey
ALTER TABLE "outreach_ai_template" ADD CONSTRAINT "outreach_ai_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_ai_template" ADD CONSTRAINT "outreach_ai_template_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
