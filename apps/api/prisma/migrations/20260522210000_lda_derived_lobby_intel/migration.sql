-- ─────────────────────────────────────────────────────────────────────────
-- LDA-derived lobby intelligence views
--
-- Replaces the openlobby.us-sourced lobby_intel + lobby_issue_ref tables
-- with views computed directly from the raw Senate LDA data already in
-- lda_filing + lda_client + lda_issue_code. lobby_trending_topics is
-- retained as a destination table (repopulated from lda_filing.lobbying_activities
-- by the rewritten sync-lobby-trending.ts script).
--
-- This migration is ADDITIVE: old tables stay in place so the API can run
-- against either source. A follow-up migration drops them after parity
-- is verified in production.
--
-- All views are GLOBAL (no tenant_id, no RLS) — same data for every tenant.
-- ─────────────────────────────────────────────────────────────────────────

-- ── lobby_intel_mv ────────────────────────────────────────────────────────
-- Top 5,000 lobbying clients ranked by 5-year total spend, with per-year
-- breakdown, growth rate, and trajectory label. Materialized for read perf;
-- refresh via REFRESH MATERIALIZED VIEW CONCURRENTLY lobby_intel_mv.
-- Drop first if it already exists from a prior failed migration.
DROP MATERIALIZED VIEW IF EXISTS lobby_intel_mv CASCADE;

CREATE MATERIALIZED VIEW lobby_intel_mv AS
WITH yearly AS (
  SELECT
    client_id,
    client_name,
    filing_year AS year,
    -- Lobbying firms report income (client→firm); in-house lobbyists report
    -- expenses (own spend). Use whichever is greater for each filing.
    GREATEST(COALESCE(income, 0), COALESCE(expenses, 0))::numeric(18,2) AS amount
  FROM lda_filing
  WHERE client_id IS NOT NULL
),
client_yearly AS (
  SELECT
    client_id,
    year,
    SUM(amount)::numeric(18,2) AS amount
  FROM yearly
  GROUP BY client_id, year
),
client_summary AS (
  SELECT
    client_id,
    jsonb_agg(jsonb_build_object('year', year, 'amount', amount) ORDER BY year) AS yearly_spend,
    array_agg(year ORDER BY year) AS years,
    MIN(year) AS first_year,
    MAX(year) AS latest_year,
    -- Recent = last 2 calendar years; prior = the 3 years before that.
    SUM(amount) FILTER (
      WHERE year >= EXTRACT(YEAR FROM CURRENT_DATE)::int - 1
    )::numeric AS recent_2y,
    SUM(amount) FILTER (
      WHERE year <  EXTRACT(YEAR FROM CURRENT_DATE)::int - 1
        AND year >= EXTRACT(YEAR FROM CURRENT_DATE)::int - 4
    )::numeric AS prior_3y,
    SUM(amount)::numeric(18,2) AS total_spending_yrs
  FROM client_yearly
  GROUP BY client_id
),
ranked AS (
  SELECT
    c.id                                AS client_id,
    c.name,
    c.state,
    COALESCE(c.total_spending, cs.total_spending_yrs) AS total_spending,
    c.total_filings                     AS filings,
    c.issue_codes                       AS issues,
    cs.years,
    cs.first_year,
    cs.latest_year,
    cs.yearly_spend,
    CASE
      WHEN cs.prior_3y IS NULL OR cs.prior_3y = 0 THEN NULL
      ELSE ((COALESCE(cs.recent_2y, 0) / 2.0) - (cs.prior_3y / 3.0))
           / NULLIF(cs.prior_3y / 3.0, 0)
    END AS growth_rate,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE(c.total_spending, cs.total_spending_yrs) DESC NULLS LAST
    ) AS rank
  FROM lda_client c
  JOIN client_summary cs ON cs.client_id = c.id
)
SELECT
  gen_random_uuid()::uuid AS id,
  -- Slug: lowercase, collapse non-alphanumeric runs to '-', trim leading/trailing '-',
  -- truncate to 200 chars. Append the client_id to guarantee uniqueness across name collisions.
  substring(
    regexp_replace(
      regexp_replace(lower(trim(name)), '[^a-z0-9]+', '-', 'g'),
      '^-+|-+$', '', 'g'
    )
    || '-' || client_id::text
    from 1 for 200
  ) AS slug,
  name,
  state,
  total_spending,
  filings,
  COALESCE(issues, ARRAY[]::text[]) AS issues,
  COALESCE(years, ARRAY[]::int[])   AS years,
  CASE
    WHEN first_year >= EXTRACT(YEAR FROM CURRENT_DATE)::int - 2
         AND latest_year >= EXTRACT(YEAR FROM CURRENT_DATE)::int - 1 THEN 'new'
    WHEN growth_rate IS NOT NULL AND growth_rate >  0.5  THEN 'exploding'
    WHEN growth_rate IS NOT NULL AND growth_rate < -0.3  THEN 'declining'
    ELSE 'steady'
  END AS trajectory,
  growth_rate::double precision AS growth_rate,
  yearly_spend,
  'lda'::text AS source,
  NOW()       AS last_synced_at
FROM ranked
WHERE rank <= 5000;

-- Unique index on slug is required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX lobby_intel_mv_slug_idx ON lobby_intel_mv (slug);
CREATE INDEX lobby_intel_mv_name_idx          ON lobby_intel_mv (name);
CREATE INDEX lobby_intel_mv_name_trgm_idx     ON lobby_intel_mv USING gin (name gin_trgm_ops);
CREATE INDEX lobby_intel_mv_trajectory_idx    ON lobby_intel_mv (trajectory);
CREATE INDEX lobby_intel_mv_total_spending_idx ON lobby_intel_mv (total_spending DESC NULLS LAST);

-- ── lobby_issue_ref_v ─────────────────────────────────────────────────────
-- Plain view (not materialized) over lda_issue_code + computed surge buckets
-- from the latest two quarters of lda_filing. Surge is computed at query time;
-- if perf becomes an issue, switch to a materialized view refreshed alongside
-- lobby_intel_mv.
DROP VIEW IF EXISTS lobby_issue_ref_v CASCADE;

CREATE VIEW lobby_issue_ref_v AS
WITH
-- Map LDA filing_period strings to a sortable ordinal within a year.
period_ord AS (
  SELECT * FROM (VALUES
    ('first_quarter',  1),
    ('second_quarter', 2),
    ('third_quarter',  3),
    ('fourth_quarter', 4),
    ('mid_year',       2),
    ('year_end',       4)
  ) AS p(name, ord)
),
filings_by_issue_period AS (
  SELECT
    unnest(f.issue_codes) AS code,
    f.filing_year,
    f.filing_period,
    COALESCE(po.ord, 0)   AS period_ord,
    GREATEST(COALESCE(f.income, 0), COALESCE(f.expenses, 0)) AS amount
  FROM lda_filing f
  LEFT JOIN period_ord po ON po.name = f.filing_period
  WHERE f.issue_codes IS NOT NULL
    AND array_length(f.issue_codes, 1) > 0
),
agg_period AS (
  SELECT
    code,
    filing_year,
    filing_period,
    period_ord,
    -- Composite quarter ordinal for ranking: year * 10 + quarter
    filing_year * 10 + period_ord AS quarter_ord,
    SUM(amount)::numeric(18,2) AS income,
    COUNT(*)::int              AS filings
  FROM filings_by_issue_period
  WHERE period_ord > 0
  GROUP BY code, filing_year, filing_period, period_ord
),
ranked_periods AS (
  SELECT
    code, filing_year, filing_period, period_ord, quarter_ord, income, filings,
    ROW_NUMBER() OVER (PARTITION BY code ORDER BY quarter_ord DESC) AS rn
  FROM agg_period
),
latest_two AS (
  SELECT
    code,
    MAX(CASE WHEN rn = 1 THEN filing_year::text || '-' || filing_period END) AS latest_quarter,
    MAX(CASE WHEN rn = 1 THEN income            END) AS latest_income,
    MAX(CASE WHEN rn = 2 THEN income            END) AS prev_income
  FROM ranked_periods
  WHERE rn <= 2
  GROUP BY code
),
totals AS (
  SELECT
    code,
    SUM(income)::numeric(18,2) AS total_spending,
    SUM(filings)::int          AS total_filings
  FROM agg_period
  WHERE filing_year >= EXTRACT(YEAR FROM CURRENT_DATE)::int - 4
  GROUP BY code
)
SELECT
  ic.code,
  ic.name,
  t.total_spending,
  t.total_filings,
  CASE
    WHEN lt.prev_income IS NULL OR lt.prev_income = 0 THEN NULL
    WHEN (lt.latest_income / lt.prev_income - 1) >  0.25 THEN 'surging'
    WHEN (lt.latest_income / lt.prev_income - 1) >  0.05 THEN 'growing'
    WHEN (lt.latest_income / lt.prev_income - 1) < -0.10 THEN 'declining'
    ELSE 'stable'
  END AS surge_trend,
  CASE
    WHEN lt.prev_income IS NULL OR lt.prev_income = 0 THEN NULL
    ELSE ((lt.latest_income / lt.prev_income - 1) * 100)::double precision
  END AS surge_pct,
  lt.latest_quarter,
  lt.latest_income,
  NOW() AS last_synced_at
FROM lda_issue_code ic
LEFT JOIN totals    t  ON t.code  = ic.code
LEFT JOIN latest_two lt ON lt.code = ic.code;

-- ── refresh helper ────────────────────────────────────────────────────────
-- Wrapper function so the API + cron can refresh the materialized view
-- without needing to remember CONCURRENTLY.
CREATE OR REPLACE FUNCTION refresh_lobby_intel_mv() RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY lobby_intel_mv;
END;
$$ LANGUAGE plpgsql;

COMMENT ON MATERIALIZED VIEW lobby_intel_mv IS
  'Top 5K lobbying clients derived from lda_filing + lda_client. Refresh with refresh_lobby_intel_mv().';
COMMENT ON VIEW lobby_issue_ref_v IS
  '79 LDA issue codes with surge buckets computed from lda_filing latest two quarters.';
