ALTER TABLE "outreach_records"
  ADD COLUMN "deleted_at" TIMESTAMPTZ(6),
  ADD COLUMN "deleted_by_user_id" UUID;

CREATE INDEX "outreach_records_tenant_deleted_created_idx"
  ON "outreach_records" ("tenant_id", "deleted_at", "created_at" DESC);
