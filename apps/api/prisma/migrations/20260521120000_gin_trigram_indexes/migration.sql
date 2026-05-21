-- GIN trigram indexes for ILIKE performance on 535K+ row lda_filing table
-- Uses pg_trgm extension (already enabled)

CREATE INDEX IF NOT EXISTS idx_lda_filing_client_name_trgm
  ON lda_filing USING gin (client_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_lda_filing_registrant_name_trgm
  ON lda_filing USING gin (registrant_name gin_trgm_ops);

-- GIN index on issue_codes array for @> (contains) queries
CREATE INDEX IF NOT EXISTS idx_lda_filing_issue_codes_gin
  ON lda_filing USING gin (issue_codes);
