-- AlterTable
ALTER TABLE "engagement_contacts" ADD COLUMN "acquisition_personnel_id" UUID;

-- AlterTable
ALTER TABLE "strategy_targets" ADD COLUMN "acquisition_personnel_id" UUID;

-- CreateTable
CREATE TABLE "acquisition_personnel" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "service" VARCHAR(8),
    "organization" TEXT,
    "title" TEXT,
    "role" TEXT,
    "program_of_record" TEXT,
    "pe_primary" VARCHAR(8),
    "pe_secondary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "email_domain" TEXT,
    "public_profile_url" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "acquisition_personnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquisition_personnel_source" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "source" VARCHAR(64) NOT NULL,
    "source_url" TEXT,
    "snippet" TEXT,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acquisition_personnel_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquisition_personnel_quarantine" (
    "id" UUID NOT NULL,
    "raw_record_jsonb" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "quarantined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acquisition_personnel_quarantine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquisition_personnel_merge_candidate" (
    "id" UUID NOT NULL,
    "primary_person_id" UUID NOT NULL,
    "secondary_person_id" UUID NOT NULL,
    "similarity_score" DOUBLE PRECISION NOT NULL,
    "score_breakdown_jsonb" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "decision_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acquisition_personnel_merge_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "acquisition_personnel_pe_primary_idx" ON "acquisition_personnel"("pe_primary");

-- CreateIndex
CREATE INDEX "acquisition_personnel_name_key_idx" ON "acquisition_personnel"("name_key");

-- CreateIndex
CREATE INDEX "acquisition_personnel_service_org_idx" ON "acquisition_personnel"("service", "organization");

-- CreateIndex
CREATE INDEX "acquisition_personnel_status_idx" ON "acquisition_personnel"("status");

-- CreateIndex
CREATE INDEX "acquisition_personnel_source_person_observed_idx" ON "acquisition_personnel_source"("person_id", "observed_at");

-- CreateIndex
CREATE INDEX "acquisition_personnel_source_source_idx" ON "acquisition_personnel_source"("source");

-- CreateIndex
CREATE INDEX "acquisition_personnel_merge_candidate_status_idx" ON "acquisition_personnel_merge_candidate"("status");

-- CreateIndex
CREATE INDEX "engagement_contacts_acquisition_personnel_id_idx" ON "engagement_contacts"("acquisition_personnel_id");

-- CreateIndex
CREATE INDEX "strategy_targets_acquisition_personnel_id_idx" ON "strategy_targets"("acquisition_personnel_id");

-- Trigram index for fuzzy name matching
CREATE INDEX IF NOT EXISTS acquisition_personnel_name_key_trgm_idx
  ON acquisition_personnel USING gin (name_key gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "acquisition_personnel_source" ADD CONSTRAINT "acquisition_personnel_source_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "acquisition_personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;