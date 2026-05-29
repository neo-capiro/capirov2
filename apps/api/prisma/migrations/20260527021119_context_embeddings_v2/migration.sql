-- Rebuilds context_embeddings for the Titan v2 embedding pipeline.
--
-- The table created in 20260503020000_engagement_manager_core was scaffolded
-- for OpenAI ada-002 / Titan v1 (1536-dim, IVFFlat) and never actually
-- populated — no code in apps/api/src/ ever wrote to it. We're activating
-- embeddings now (Titan Text Embeddings v2 @ 1024-dim, HNSW index), with
-- two new columns to make re-embeds cheap and idempotent:
--
--   * model        — tracks which embedding model produced the row, so we
--                    can run multiple models side-by-side and migrate
--                    incrementally on model rolls.
--   * content_hash — sha256 of the normalized source text; lets the worker
--                    short-circuit when the source row hasn't changed.
--
-- tenant_id is now NULLABLE: global content (CongressBill, LdaFiling) has
-- no tenant. The RLS policy allows any tenant to read NULL-tenant rows,
-- but writes still require own-tenant (or rls_bypass for the global
-- backfill workers).
--
-- Because nothing has been written to the table, dropping and recreating
-- is safer than ALTER (changing vector dimensionality on a non-empty
-- table requires a column rebuild anyway).

DROP TABLE IF EXISTS "context_embeddings" CASCADE;

CREATE TABLE "context_embeddings" (
  "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"      UUID NULL,
  "client_id"      UUID NULL,
  "source_type"    TEXT NOT NULL,
  "source_id"      TEXT NOT NULL,
  "model"          TEXT NOT NULL,
  "content_text"   TEXT NOT NULL,
  "content_hash"   TEXT NOT NULL,
  "embedding"      vector(1024) NOT NULL,
  "metadata_jsonb" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "context_embeddings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "context_embeddings_tenant_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "context_embeddings_client_fkey" FOREIGN KEY ("client_id")
    REFERENCES "clients"("id") ON DELETE SET NULL,
  -- NULLS NOT DISTINCT is the Postgres 15+ flag that makes (NULL, 'bill', '119-hr-1')
  -- equal to (NULL, 'bill', '119-hr-1') for uniqueness purposes. Without it,
  -- two NULL-tenant rows for the same source would both be allowed.
  CONSTRAINT "context_embeddings_unique"
    UNIQUE NULLS NOT DISTINCT ("tenant_id", "source_type", "source_id", "model")
);

CREATE INDEX "context_embeddings_tenant_client_idx"
  ON "context_embeddings" ("tenant_id", "client_id");
CREATE INDEX "context_embeddings_source_idx"
  ON "context_embeddings" ("source_type", "source_id");
-- HNSW with cosine — Titan v2 vectors are not pre-normalized so cosine
-- (not inner product) is the right operator.
CREATE INDEX "context_embeddings_embedding_hnsw"
  ON "context_embeddings" USING hnsw ("embedding" vector_cosine_ops);

-- Row-Level Security.
--
-- READ:  rls_bypass, OR row is global (tenant_id IS NULL), OR row belongs
--        to the current tenant.
-- WRITE: rls_bypass (used by global backfill workers running as capiro_admin),
--        OR row belongs to the current tenant. NULL-tenant inserts require
--        rls_bypass — only the admin role gets to write global content.
ALTER TABLE "context_embeddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "context_embeddings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "context_embeddings_isolation" ON "context_embeddings"
  USING (rls_bypass() OR tenant_id IS NULL OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capiro_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "context_embeddings" TO capiro_app;
  END IF;
END
$$;
