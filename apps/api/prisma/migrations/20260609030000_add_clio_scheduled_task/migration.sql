-- Clio self-scheduled recurring tasks (W3).
--
-- A user can ask Clio to run something on a cadence (e.g. a weekly research
-- brief). The runner (scripts/run-clio-scheduled-tasks.ts) executes due rows
-- through the Clio tool engine with the task's tool allow-list. v1 ships with
-- side-effecting/email tools DISABLED for unattended runs (enforced in the tool
-- + runner layer); the default allow-list is read-only research tools.
--
-- RLS: tenant-isolated, fail-closed, matching clio_memory / client_capabilities.
-- Policy functions current_tenant_id() / rls_bypass() are defined in
-- 20260501000000_init_identity_tenancy. The runner reads due rows across tenants
-- via the bypass path (withSystem) then re-enters per-tenant context to execute.

CREATE TABLE "clio_scheduled_task" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'user_private',
    "name" VARCHAR(200) NOT NULL,
    "prompt" TEXT NOT NULL,
    "interval_minutes" INTEGER NOT NULL,
    "tool_allow_list" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMPTZ(6),
    "next_run_at" TIMESTAMPTZ(6) NOT NULL,
    "last_status" VARCHAR(20),
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" VARCHAR(40) NOT NULL DEFAULT 'clio',
    "metadata_jsonb" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "clio_scheduled_task_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clio_scheduled_task_scope_check" CHECK ("scope" IN ('firm', 'user_private')),
    CONSTRAINT "clio_scheduled_task_interval_check" CHECK ("interval_minutes" >= 60),
    CONSTRAINT "clio_scheduled_task_tenant_fkey" FOREIGN KEY ("tenant_id")
        REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "clio_scheduled_task_tenant_owner_idx"
    ON "clio_scheduled_task" ("tenant_id", "owner_user_id", "created_at" DESC);
CREATE INDEX "clio_scheduled_task_due_idx"
    ON "clio_scheduled_task" ("enabled", "next_run_at");

ALTER TABLE "clio_scheduled_task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clio_scheduled_task" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clio_scheduled_task_isolation" ON "clio_scheduled_task"
    USING (rls_bypass() OR tenant_id = current_tenant_id())
    WITH CHECK (rls_bypass() OR tenant_id = current_tenant_id());
