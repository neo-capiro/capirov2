-- Tear down the entire Clio agent workspace. The feature was deleted
-- from the codebase; this migration drops the schema objects to match.
--
-- Order: child tables first, then parent tables, then enums. CASCADE
-- on the parents would also work, but explicit drops keep the dependency
-- intent visible and avoid surprising downstream catalog state.

DROP TABLE IF EXISTS "clio_outbound_mail" CASCADE;
DROP TABLE IF EXISTS "clio_inbound_mail"  CASCADE;
DROP TABLE IF EXISTS "clio_mailboxes"     CASCADE;
DROP TABLE IF EXISTS "clio_messages"      CASCADE;
DROP TABLE IF EXISTS "clio_artifacts"     CASCADE;
DROP TABLE IF EXISTS "clio_sessions"      CASCADE;
DROP TABLE IF EXISTS "clio_user_memories" CASCADE;

DROP TYPE IF EXISTS "clio_artifact_kind";
DROP TYPE IF EXISTS "clio_message_role";
DROP TYPE IF EXISTS "clio_session_status";

-- Clean up the historical migration rows for the deleted Clio migrations
-- so `prisma migrate status` no longer reports them as applied. Cosmetic —
-- prisma migrate deploy already tolerates rows whose folders are gone,
-- but this keeps the table reflecting the actual on-disk state.
DELETE FROM "_prisma_migrations"
 WHERE migration_name IN (
   '20260510120000_clio_workspace',
   '20260511020000_clio_artifact_status_versions',
   '20260512000000_clio_user_memory',
   '20260513000000_clio_per_user_mailbox'
 );
