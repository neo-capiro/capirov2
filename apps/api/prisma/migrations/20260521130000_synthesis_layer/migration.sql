-- Synthesis layer tables

-- Client-to-intelligence-source mapping
CREATE TABLE IF NOT EXISTS client_intel_mapping (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL,
  source          TEXT NOT NULL,
  external_id     TEXT NOT NULL,
  external_name   TEXT NOT NULL,
  confidence      DOUBLE PRECISION NOT NULL,
  confirmed       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  UNIQUE (client_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_cim_client ON client_intel_mapping(client_id);
CREATE INDEX IF NOT EXISTS idx_cim_source ON client_intel_mapping(source, external_id);

-- Cross-source change events
CREATE TABLE IF NOT EXISTS intelligence_change (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source            TEXT NOT NULL,
  change_type       TEXT NOT NULL,
  severity          TEXT NOT NULL DEFAULT 'info',
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  related_client_ids UUID[] DEFAULT '{}',
  related_issues    TEXT[] DEFAULT '{}',
  data              JSONB NOT NULL DEFAULT '{}',
  detected_at       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  consumed          BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_ic_detected ON intelligence_change(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_ic_source ON intelligence_change(source, change_type);
