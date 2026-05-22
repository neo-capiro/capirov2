-- AI Copilot chat message history table

CREATE TABLE IF NOT EXISTS chat_message (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  metadata    JSONB,
  session_id  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_message_tenant_user_session
  ON chat_message(tenant_id, user_id, session_id);

CREATE INDEX IF NOT EXISTS idx_chat_message_created_at
  ON chat_message(created_at);
