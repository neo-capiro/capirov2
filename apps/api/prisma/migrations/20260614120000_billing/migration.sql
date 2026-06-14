-- CreateEnum
CREATE TYPE "billing_status" AS ENUM ('none', 'trialing', 'active', 'past_due', 'canceled', 'comped');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "billing_status" "billing_status" NOT NULL DEFAULT 'none',
ADD COLUMN     "client_slots" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "current_period_end" TIMESTAMPTZ(6),
ADD COLUMN     "llm_allowance_usd_per_slot" DECIMAL(12,2) NOT NULL DEFAULT 20,
ADD COLUMN     "llm_hard_cap_usd" DECIMAL(12,2),
ADD COLUMN     "stripe_customer_id" TEXT,
ADD COLUMN     "stripe_subscription_id" TEXT;

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_jsonb" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "error" TEXT,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_usage_meters" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "reported_overage_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_usage_meters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stripe_events_event_id_key" ON "stripe_events"("event_id");

-- CreateIndex
CREATE INDEX "stripe_events_event_type_idx" ON "stripe_events"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_usage_meters_tenant_period_key" ON "tenant_usage_meters"("tenant_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_stripe_customer_id_key" ON "tenants"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_stripe_subscription_id_key" ON "tenants"("stripe_subscription_id");

-- AddForeignKey
ALTER TABLE "tenant_usage_meters" ADD CONSTRAINT "tenant_usage_meters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
