-- Persist the AI-generated prior-correspondence recap (previously generated but dropped).
ALTER TABLE "meeting_preps"
  ADD COLUMN IF NOT EXISTS "email_evidence_jsonb" JSONB NOT NULL DEFAULT '[]';
