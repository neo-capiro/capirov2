-- GovInfo (api.data.gov) 24h JSON response cache. Global table (no tenant_id, no RLS).
-- Keyed by request URL with the api_key query param stripped before storage.
CREATE TABLE IF NOT EXISTS "govinfo_cache" (
    "id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "response_jsonb" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "govinfo_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "govinfo_cache_url_key" ON "govinfo_cache" ("url");
CREATE INDEX IF NOT EXISTS "govinfo_cache_fetched_at_idx" ON "govinfo_cache" ("fetched_at");
