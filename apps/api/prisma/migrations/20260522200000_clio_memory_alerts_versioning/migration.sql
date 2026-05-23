-- Clio memory: firm-level knowledge base that grows over time
CREATE TABLE "clio_memory" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'conversation',
    "embedding" vector(1536),
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clio_memory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clio_memory_tenant_id_key_key" ON "clio_memory"("tenant_id", "key");
CREATE INDEX "clio_memory_tenant_id_updated_at_idx" ON "clio_memory"("tenant_id", "updated_at" DESC);

ALTER TABLE "clio_memory" ADD CONSTRAINT "clio_memory_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Clio proactive alerts: AI-generated insights and reminders
CREATE TABLE "clio_proactive_alerts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "client_id" UUID,
    "alert_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source_type" TEXT,
    "source_id" TEXT,
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    CONSTRAINT "clio_proactive_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clio_proactive_alerts_tenant_status_created_idx" ON "clio_proactive_alerts"("tenant_id", "status", "created_at" DESC);
CREATE INDEX "clio_proactive_alerts_tenant_client_created_idx" ON "clio_proactive_alerts"("tenant_id", "client_id", "created_at" DESC);

ALTER TABLE "clio_proactive_alerts" ADD CONSTRAINT "clio_proactive_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clio_proactive_alerts" ADD CONSTRAINT "clio_proactive_alerts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Artifact versioning: parent_artifact_id for version chains
ALTER TABLE "clio_artifacts" ADD COLUMN "parent_artifact_id" UUID;
ALTER TABLE "clio_artifacts" ADD CONSTRAINT "clio_artifacts_parent_artifact_id_fkey" FOREIGN KEY ("parent_artifact_id") REFERENCES "clio_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
