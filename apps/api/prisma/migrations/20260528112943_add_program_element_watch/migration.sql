-- Migration: add_program_element_watch
-- Per-user PE watch list. Same db-push cleanup as siblings.
DROP TABLE IF EXISTS "program_element_watch" CASCADE;

CREATE TABLE IF NOT EXISTS "program_element_watch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "pe_code" VARCHAR(8) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "program_element_watch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "program_element_watch_user_pe_code_key" ON "program_element_watch"("user_id", "pe_code");
CREATE INDEX IF NOT EXISTS "program_element_watch_tenant_pe_code_idx" ON "program_element_watch"("tenant_id", "pe_code");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'program_element_watch_user_fkey') THEN
        ALTER TABLE "program_element_watch"
        ADD CONSTRAINT "program_element_watch_user_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'program_element_watch_tenant_fkey') THEN
        ALTER TABLE "program_element_watch"
        ADD CONSTRAINT "program_element_watch_tenant_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'program_element_watch_pe_code_fkey') THEN
        ALTER TABLE "program_element_watch"
        ADD CONSTRAINT "program_element_watch_pe_code_fkey"
        FOREIGN KEY ("pe_code") REFERENCES "program_element"("pe_code") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;
