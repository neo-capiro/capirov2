ALTER TABLE client_capabilities
  ADD COLUMN IF NOT EXISTS issue_codes_jsonb jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS client_capabilities_issue_codes_gin
  ON client_capabilities USING gin (issue_codes_jsonb);
