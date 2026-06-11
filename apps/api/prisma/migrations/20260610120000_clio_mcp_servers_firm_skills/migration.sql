-- Clio extensibility config tables (assistant-parity F6).
--
-- clio_mcp_servers (F6a): tenant-configured MCP servers. Bearer tokens for
-- streamable-HTTP servers are AES-256-GCM encrypted at rest (ciphertext / iv /
-- auth-tag / key-version columns, same pattern as engagement_connection_tokens)
-- and never stored or returned in plaintext. Tools are bridged as
-- mcp__<name>__<tool>; only allowlisted tools register, and every bridged tool
-- is treated as side-effecting unless listed in read_only_tools.
--
-- clio_firm_skills (F6b): firm-authored skills. skill_jsonb holds the
-- validated FirmSkill shape (id, name, triggers, systemAddendum,
-- requiredTools, template); versions_jsonb holds prior snapshots (newest
-- first) for restore. Built-in skills always win on trigger conflict via the
-- registry safe-merge.
--
-- RLS: tenant-isolated, fail-closed, matching clio_memory. Policy functions
-- current_tenant_id() / rls_bypass() are defined in
-- 20260501000000_init_identity_tenancy.

CREATE TABLE "clio_mcp_servers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "transport" VARCHAR(10) NOT NULL,
    "endpoint" VARCHAR(500),
    "command" VARCHAR(500),
    "args" JSONB NOT NULL DEFAULT '[]',
    "env_jsonb" JSONB NOT NULL DEFAULT '{}',
    "auth_token_ciphertext" TEXT,
    "auth_token_iv" TEXT,
    "auth_token_auth_tag" TEXT,
    "auth_key_version" TEXT,
    "tool_allowlist" JSONB NOT NULL DEFAULT '[]',
    "read_only_tools" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "clio_mcp_servers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clio_mcp_servers_transport_check" CHECK ("transport" IN ('http', 'stdio')),
    CONSTRAINT "clio_mcp_servers_tenant_fkey" FOREIGN KEY ("tenant_id")
        REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "clio_mcp_servers_tenant_name_unique"
    ON "clio_mcp_servers" ("tenant_id", "name");
CREATE INDEX "clio_mcp_servers_tenant_enabled_idx"
    ON "clio_mcp_servers" ("tenant_id", "enabled");

ALTER TABLE "clio_mcp_servers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_mcp_servers" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_mcp_servers_isolation" ON "clio_mcp_servers"
    USING (rls_bypass() OR tenant_id = current_tenant_id())
    WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());

CREATE TABLE "clio_firm_skills" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "skill_id" VARCHAR(48) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "skill_jsonb" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "versions_jsonb" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "clio_firm_skills_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clio_firm_skills_tenant_fkey" FOREIGN KEY ("tenant_id")
        REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "clio_firm_skills_tenant_skill_unique"
    ON "clio_firm_skills" ("tenant_id", "skill_id");
CREATE INDEX "clio_firm_skills_tenant_enabled_idx"
    ON "clio_firm_skills" ("tenant_id", "enabled", "updated_at" DESC);

ALTER TABLE "clio_firm_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_firm_skills" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_firm_skills_isolation" ON "clio_firm_skills"
    USING (rls_bypass() OR tenant_id = current_tenant_id())
    WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
