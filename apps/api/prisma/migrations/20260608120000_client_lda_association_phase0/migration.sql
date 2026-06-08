-- Client→data association overhaul, Phase 0 (additive foundation).
-- Pure column additions with safe defaults: no backfill, no reads changed, no
-- behavior change. Provably non-breaking — existing code ignores these columns
-- until the later phases populate and read them.
--
--   tenants.lda_registrant_id / lda_registrant_name
--       The lobbying firm this tenant files as. Lets client→LDA resolution be
--       anchored to this registrant's filings (lda_filing.registrant_id).
--   clients.lda_client_ids
--       Confirmed set of Senate LDA client_ids this client resolves to (one per
--       firm relationship). Denormalized read-cache of confirmed source='lda'
--       client_intel_mapping rows; read path joins lda_filing.client_id = ANY(...).

ALTER TABLE "tenants" ADD COLUMN "lda_registrant_id" INTEGER;
ALTER TABLE "tenants" ADD COLUMN "lda_registrant_name" TEXT;
ALTER TABLE "clients" ADD COLUMN "lda_client_ids" INTEGER[] NOT NULL DEFAULT '{}';
