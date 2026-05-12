-- Persistent per-user memory for the Clio agent. Survives across
-- sessions; injected into the system prompt on every turn so Clio knows
-- the human it's talking to.

CREATE TABLE "clio_user_memories" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "category" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "ref_count" INTEGER NOT NULL DEFAULT 0,
  "last_used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "clio_user_memories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clio_user_memories_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_user_memories_user_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "clio_user_memories_content_check" CHECK (length(trim("content")) > 0),
  CONSTRAINT "clio_user_memories_category_check" CHECK (length(trim("category")) > 0)
);

CREATE INDEX "clio_user_memories_tenant_user_updated_idx"
  ON "clio_user_memories" ("tenant_id", "user_id", "updated_at" DESC);
CREATE INDEX "clio_user_memories_tenant_user_category_idx"
  ON "clio_user_memories" ("tenant_id", "user_id", "category");

CREATE TRIGGER "clio_user_memories_set_updated_at"
  BEFORE UPDATE ON "clio_user_memories"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "clio_user_memories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_user_memories" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_user_memories_isolation" ON "clio_user_memories"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "clio_user_memories" TO capiro_app;
  END IF;
END
$$;
