-- Widen pe_code / pe_primary columns from VARCHAR(8) to VARCHAR(16) so the
-- validator-admitted Defense-Wide (e.g. 0604122D8Z) and Space Force (e.g.
-- 1203622SF) Program Element codes — 9-10 chars — can be stored. The old
-- VARCHAR(8) cap silently rejected ~534 valid codes (P2000 on insert).
--
-- program_element_detail_mv depends on program_element.pe_code, so it must be
-- dropped before the ALTER and recreated after (Postgres refuses to alter a
-- column a materialized view references). Definition + unique index are
-- reproduced verbatim from 20260529091500_add_pe_materialized_views.

DROP MATERIALIZED VIEW IF EXISTS "program_element_detail_mv";

ALTER TABLE "program_element"                  ALTER COLUMN "pe_code"    TYPE VARCHAR(16);
ALTER TABLE "program_element_source"           ALTER COLUMN "pe_code"    TYPE VARCHAR(16);
ALTER TABLE "program_element_project"          ALTER COLUMN "pe_code"    TYPE VARCHAR(16);
ALTER TABLE "program_element_year"             ALTER COLUMN "pe_code"    TYPE VARCHAR(16);
ALTER TABLE "program_element_milestone"        ALTER COLUMN "pe_code"    TYPE VARCHAR(16);
ALTER TABLE "program_element_year_source_value" ALTER COLUMN "pe_code"   TYPE VARCHAR(16);
ALTER TABLE "program_element_watch"            ALTER COLUMN "pe_code"    TYPE VARCHAR(16);
ALTER TABLE "conference_probability"           ALTER COLUMN "pe_code"    TYPE VARCHAR(16);
ALTER TABLE "acquisition_personnel"            ALTER COLUMN "pe_primary" TYPE VARCHAR(16);

CREATE MATERIALIZED VIEW "program_element_detail_mv" AS
 SELECT pe_code,
    title,
    service,
    budget_activity,
    acat_level,
    status,
    ( SELECT row_to_json(y.*) AS row_to_json
           FROM ( SELECT program_element_year.id,
                    program_element_year.pe_code,
                    program_element_year.fy,
                    program_element_year.request,
                    program_element_year.hasc_mark,
                    program_element_year.sasc_mark,
                    program_element_year.hac_d_mark,
                    program_element_year.sac_d_mark,
                    program_element_year.conference,
                    program_element_year.enacted,
                    program_element_year.reprogrammed,
                    program_element_year.executed,
                    program_element_year.notes,
                    program_element_year.r_doc_section,
                    program_element_year.raw_jsonb,
                    program_element_year.last_synced_at
                   FROM program_element_year
                  WHERE program_element_year.pe_code::text = pe.pe_code::text
                  ORDER BY program_element_year.fy DESC
                 LIMIT 1) y) AS latest_year,
    ( SELECT count(*) AS count
           FROM congress_bill
          WHERE pe.pe_code::text = ANY (congress_bill.pe_codes)) AS bill_count
   FROM program_element pe;

CREATE UNIQUE INDEX "program_element_detail_mv_pe_code_idx" ON "program_element_detail_mv" USING btree (pe_code);
