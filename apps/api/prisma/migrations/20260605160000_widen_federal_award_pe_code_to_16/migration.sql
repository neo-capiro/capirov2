-- Widen federal_award.pe_code from VARCHAR(8) to VARCHAR(16) to match the
-- program_element.pe_code canon (already VARCHAR(16) via 20260530170000) and the
-- isValidPeCode validator, which admits variable-length Defense-Wide (e.g.
-- 0604122D8Z) and Space Force (e.g. 1203940SF) codes — 9-10 chars. The old
-- VARCHAR(8) cap forced enrich-award-pe to SKIP the pe write for those codes
-- (logged "exceeds VARCHAR(8)"), silently undercounting contractor->PE links for
-- the entire Space Force / Defense-Wide portfolio.
--
-- No materialized view references federal_award.pe_code, so (unlike the
-- program_element widen) no MV drop/recreate is needed. The existing
-- federal_award_pe_code_idx btree is rebuilt automatically by the type change.
-- Pure widen: no data loss, no truncation (target is strictly larger).

ALTER TABLE "federal_award" ALTER COLUMN "pe_code" TYPE VARCHAR(16);
