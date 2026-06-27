-- Drop the legacy White Paper Studio / Workflows / Strategies / old-chat subsystem.
-- These were the old document-generation + strategy surfaces, now fully retired and
-- replaced by the new Workspace engine (apps/workspace, ws_* tables in a SEPARATE
-- schema/DB — untouched here). The old frontend, backend modules, and Meri tool
-- wiring were removed in the same change; this migration drops the now-unused tables.
--
-- Removed models: WorkflowInstance, WorkflowTemplate, Strategy, StrategyTarget,
-- ChatMessage; and the workflow_status enum. CASCADE removes the foreign-key
-- constraints these tables held against tenants/users/clients/client_capabilities.
-- This is intentional, irreversible data removal (product decision 2026-06-27).

DROP TABLE IF EXISTS "workflow_instances" CASCADE;
DROP TABLE IF EXISTS "strategy_targets" CASCADE;
DROP TABLE IF EXISTS "strategies" CASCADE;
DROP TABLE IF EXISTS "workflow_templates" CASCADE;
DROP TABLE IF EXISTS "chat_message" CASCADE;

DROP TYPE IF EXISTS "workflow_status";
