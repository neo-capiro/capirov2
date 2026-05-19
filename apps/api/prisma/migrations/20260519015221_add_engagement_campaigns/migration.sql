-- CreateTable
CREATE TABLE "engagement_campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'custom',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "subject" TEXT,
    "body" TEXT,
    "source_context_jsonb" JSONB NOT NULL DEFAULT '{}',
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "engagement_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_campaign_recipients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "title" TEXT,
    "office" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMPTZ(6),
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "engagement_campaigns_tenant_client_status_idx" ON "engagement_campaigns"("tenant_id", "client_id", "status");

-- CreateIndex
CREATE INDEX "engagement_campaign_recipients_tenant_campaign_idx" ON "engagement_campaign_recipients"("tenant_id", "campaign_id");

-- AddForeignKey
ALTER TABLE "engagement_campaigns" ADD CONSTRAINT "engagement_campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_campaigns" ADD CONSTRAINT "engagement_campaigns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_campaigns" ADD CONSTRAINT "engagement_campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_campaign_recipients" ADD CONSTRAINT "engagement_campaign_recipients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_campaign_recipients" ADD CONSTRAINT "engagement_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "engagement_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
