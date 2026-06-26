-- Institutional Memory — tables + Row-Level Security.
--
-- Status: AUTHORED, NOT APPLIED (Neo DB guardrail). Place under
--   apps/api/prisma/migrations/20260625000000_institutional_memory/migration.sql
-- after merging the schema fragment, then review before applying in staging.
--
-- Follows the established RLS pattern (migration 20260501000000): every
-- tenant-scoped table is ENABLE + FORCE ROW LEVEL SECURITY with an isolation
-- policy keyed on current_tenant_id()/rls_bypass(). Outside a per-request
-- transaction the GUC is empty and reads fail-closed to zero rows.

-- ----------------------------------------------------------------------------
-- memory_items
-- ----------------------------------------------------------------------------
CREATE TABLE "memory_items" (
  "id"             UUID         NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"      UUID         NOT NULL,
  "client_id"      UUID,
  "owner_user_id"  UUID,
  "type"           VARCHAR(32)  NOT NULL,
  "visibility"     VARCHAR(16)  NOT NULL DEFAULT 'tenant',
  "entity_id"      UUID,
  "slug"           TEXT         NOT NULL,
  "title"          TEXT         NOT NULL,
  "aliases"        TEXT[]       NOT NULL DEFAULT '{}',
  "tags"           TEXT[]       NOT NULL DEFAULT '{}',
  "source"         VARCHAR(24)  NOT NULL,
  "source_ref"     TEXT,
  "provenance"     VARCHAR(32)  NOT NULL DEFAULT 'human',
  "sections_jsonb" JSONB        NOT NULL DEFAULT '[]',
  "schema_version" INTEGER      NOT NULL DEFAULT 1,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "memory_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_items_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  -- Private items MUST name an owner; firm items MUST NOT.
  CONSTRAINT "memory_items_owner_visibility_chk" CHECK (
    ("visibility" = 'user'   AND "owner_user_id" IS NOT NULL) OR
    ("visibility" = 'tenant' AND "owner_user_id" IS NULL)
  ),
  CONSTRAINT "memory_items_visibility_chk"
    CHECK ("visibility" IN ('tenant', 'user'))
);

CREATE UNIQUE INDEX "memory_items_tenant_type_slug_unique"
  ON "memory_items" ("tenant_id", "type", "slug");
CREATE INDEX "memory_items_tenant_client_idx"
  ON "memory_items" ("tenant_id", "client_id");
CREATE INDEX "memory_items_tenant_visibility_owner_idx"
  ON "memory_items" ("tenant_id", "visibility", "owner_user_id");
CREATE INDEX "memory_items_tenant_type_idx"
  ON "memory_items" ("tenant_id", "type");
CREATE INDEX "memory_items_entity_idx"
  ON "memory_items" ("entity_id");

ALTER TABLE "memory_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "memory_items_isolation" ON "memory_items"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

-- ----------------------------------------------------------------------------
-- memory_edges (wikilink-derived graph, re-derivable cache)
-- ----------------------------------------------------------------------------
CREATE TABLE "memory_edges" (
  "id"           UUID         NOT NULL DEFAULT uuid_generate_v4(),
  "tenant_id"    UUID         NOT NULL,
  "src_item_id"  UUID         NOT NULL,
  "relation"     VARCHAR(32)  NOT NULL DEFAULT 'mentions',
  "dst_type"     VARCHAR(32)  NOT NULL,
  "dst_slug"     TEXT         NOT NULL,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "memory_edges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memory_edges_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "memory_edges_src_fk"
    FOREIGN KEY ("src_item_id") REFERENCES "memory_items"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "memory_edges_unique"
  ON "memory_edges" ("src_item_id", "relation", "dst_type", "dst_slug");
CREATE INDEX "memory_edges_tenant_dst_idx"
  ON "memory_edges" ("tenant_id", "dst_type", "dst_slug");

ALTER TABLE "memory_edges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memory_edges" FORCE ROW LEVEL SECURITY;
CREATE POLICY "memory_edges_isolation" ON "memory_edges"
  USING (rls_bypass() OR tenant_id = current_tenant_id())
  WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
