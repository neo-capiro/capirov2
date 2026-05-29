CREATE MATERIALIZED VIEW program_element_detail_mv AS
SELECT
  pe.pe_code,
  pe.title,
  pe.service,
  pe.budget_activity,
  pe.acat_level,
  pe.status,
  (
    SELECT row_to_json(y)
    FROM (
      SELECT *
      FROM program_element_year
      WHERE pe_code = pe.pe_code
      ORDER BY fy DESC
      LIMIT 1
    ) y
  ) AS latest_year,
  (
    SELECT count(*)
    FROM congress_bill
    WHERE pe.pe_code = ANY(pe_codes)
  ) AS bill_count
FROM program_element pe;

CREATE UNIQUE INDEX program_element_detail_mv_pe_code_idx
  ON program_element_detail_mv (pe_code);
