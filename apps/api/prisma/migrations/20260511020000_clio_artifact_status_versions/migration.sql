ALTER TABLE "clio_artifacts"
  ADD COLUMN "replacing_artifact_id" UUID,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "clio_artifacts_replacing_version_idx"
  ON "clio_artifacts" ("tenant_id", "replacing_artifact_id", "version");

