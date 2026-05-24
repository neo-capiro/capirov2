-- AlterTable: add accountType and planTier to tenants
ALTER TABLE "tenants" ADD COLUMN "account_type" TEXT;
ALTER TABLE "tenants" ADD COLUMN "plan_tier" TEXT NOT NULL DEFAULT 'FOUNDATION';

-- AlterTable: add portfolio fields to clients
ALTER TABLE "clients" ADD COLUMN "sector_tag" TEXT;
ALTER TABLE "clients" ADD COLUMN "profile_type" TEXT DEFAULT 'CLIENT';
ALTER TABLE "clients" ADD COLUMN "profile_status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "clients" ADD COLUMN "submission_tracks" TEXT[] NOT NULL DEFAULT '{}';
