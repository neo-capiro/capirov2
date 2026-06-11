-- Clio conversation compaction (assistant-parity F2).
--
-- Rolling summary of turns older than summary_up_to_message_id, regenerated
-- incrementally by an after-turn async job (never on the streaming path).
-- Turn assembly injects the summary block ahead of the verbatim history tail
-- so long conversations stay under the prompt budget without losing early
-- facts. summary_tokens is the estimated token size of the stored summary.

ALTER TABLE "clio_conversations" ADD COLUMN "summary" TEXT;
ALTER TABLE "clio_conversations" ADD COLUMN "summary_up_to_message_id" UUID;
ALTER TABLE "clio_conversations" ADD COLUMN "summary_tokens" INTEGER;
