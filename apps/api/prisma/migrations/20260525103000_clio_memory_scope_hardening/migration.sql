-- Harden Clio memory scoping for production safety
-- 1) Add first-class scope/user ownership columns
ALTER TABLE "clio_memory"
  ADD COLUMN IF NOT EXISTS "scope" TEXT NOT NULL DEFAULT 'firm',
  ADD COLUMN IF NOT EXISTS "owner_user_id" UUID;

-- 2) Backfill existing rows from legacy conventions
-- user:<userId>:<key> => user_private scope + owner_user_id + stripped key
UPDATE "clio_memory"
SET
  "scope" = 'user_private',
  "owner_user_id" = NULLIF(substring("key" from '^user:([0-9a-fA-F-]{36}):'), '')::uuid,
  "key" = regexp_replace("key", '^user:[0-9a-fA-F-]{36}:', '')
WHERE "key" ~ '^user:[0-9a-fA-F-]{36}:.*';

-- legacy source marker from app logic
UPDATE "clio_memory"
SET "scope" = 'user_private'
WHERE "source" = 'user_style'
  AND "scope" <> 'user_private';

-- for legacy user_style rows without namespaced key, infer user from metadata
UPDATE "clio_memory"
SET "owner_user_id" = NULLIF("metadata_jsonb"->>'userId', '')::uuid
WHERE "scope" = 'user_private'
  AND "owner_user_id" IS NULL
  AND ("metadata_jsonb"->>'userId') ~ '^[0-9a-fA-F-]{36}$';

-- default any unresolved private rows back to firm to avoid orphaned private records
UPDATE "clio_memory"
SET "scope" = 'firm',
    "owner_user_id" = NULL
WHERE "scope" = 'user_private'
  AND "owner_user_id" IS NULL;

-- normalize source labels for compatibility with existing retrieval logic
UPDATE "clio_memory"
SET "source" = 'firm'
WHERE "source" IN ('conversation', 'firm')
  AND "scope" = 'firm';

UPDATE "clio_memory"
SET "source" = 'user_style'
WHERE "scope" = 'user_private';

-- 3) Resolve duplicate keys before new uniqueness model
-- Keep newest row by updated_at, then created_at, then id
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenant_id", "scope", "owner_user_id", "key"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS rn
  FROM "clio_memory"
)
DELETE FROM "clio_memory" m
USING ranked r
WHERE m."id" = r."id"
  AND r.rn > 1;

-- 4) Replace legacy indexes with scope-safe indexes
DROP INDEX IF EXISTS "clio_memory_tenant_id_key_key";
DROP INDEX IF EXISTS "clio_memory_tenant_id_updated_at_idx";
DROP INDEX IF EXISTS "clio_memory_tenant_scope_owner_key_uniq";
DROP INDEX IF EXISTS "clio_memory_scope_owner_updated_idx";
DROP INDEX IF EXISTS "clio_memory_scope_updated_idx";

CREATE UNIQUE INDEX "clio_memory_tenant_scope_owner_key_uniq"
  ON "clio_memory"("tenant_id", "scope", "owner_user_id", "key");

CREATE INDEX "clio_memory_scope_owner_updated_idx"
  ON "clio_memory"("tenant_id", "scope", "owner_user_id", "updated_at" DESC);

CREATE INDEX "clio_memory_scope_updated_idx"
  ON "clio_memory"("tenant_id", "scope", "updated_at" DESC);

-- 5) Hard constraints to enforce policy
ALTER TABLE "clio_memory"
  DROP CONSTRAINT IF EXISTS "clio_memory_scope_owner_check";

ALTER TABLE "clio_memory"
  ADD CONSTRAINT "clio_memory_scope_owner_check"
  CHECK (
    ("scope" = 'firm' AND "owner_user_id" IS NULL)
    OR ("scope" = 'user_private' AND "owner_user_id" IS NOT NULL)
  );

ALTER TABLE "clio_memory"
  DROP CONSTRAINT IF EXISTS "clio_memory_scope_check";

ALTER TABLE "clio_memory"
  ADD CONSTRAINT "clio_memory_scope_check"
  CHECK ("scope" IN ('firm', 'user_private'));
