-- ============================================================================
-- Knowledge-graph views.
--
-- One logical graph, two zones:
--   • kg_canonical_edges — universal data (bills, FEC, LDA, FARA, hearings,
--     contributions, dockets, SEC). One source-of-truth row per fact;
--     identical view across every tenant.
--   • kg_tenant_edges    — overlay edges private to a tenant: client→external
--     mapping, capability→PE, meeting/mail→client, manual overrides. These
--     views JOIN to RLS-protected base tables so tenant scoping is inherited
--     rather than re-implemented in the function layer.
--
-- kg_edges = UNION ALL of both. kg_neighbors() and kg_walk() are the single
-- query surface; every traversal goes through them so callers don't need to
-- know which zone holds a given edge.
--
-- Row shape:
--   (src_kind, src_id, dst_kind, dst_id, edge_type, confidence, source,
--    observed_at, tenant_id NULLABLE — NULL for canonical rows)
--
-- IDs are text. Node identifiers are heterogeneous across sources (UUIDs for
-- tenant tables, integers for LDA/FEC, slugs for committees, free strings
-- for FECc contributor employer). Casting to text gives us one join column
-- across the union without per-kind branching at query time. The `kind`
-- column is the discriminator — never parse the id to learn what it points
-- at.
--
-- Confidence + source are first-class so callers can rank conflicting edges.
-- Manual overrides emit `source = 'manual_override'` and `confidence = 1.0`
-- — by convention, they win on conflict (the API layer is responsible for
-- applying that resolution rule).
-- ============================================================================

DROP VIEW IF EXISTS kg_edges CASCADE;
DROP VIEW IF EXISTS kg_canonical_edges CASCADE;
DROP VIEW IF EXISTS kg_tenant_edges CASCADE;

-- ----------------------------------------------------------------------------
-- CANONICAL ZONE
-- No tenant_id on the underlying tables; emit NULL so the column is uniform.
-- ----------------------------------------------------------------------------
CREATE VIEW kg_canonical_edges AS
  -- Bill → committee (jurisdiction). Prefer committee_code as the stable id
  -- when present; fall back to committee_name.
  SELECT
    'bill'::text                                              AS src_kind,
    bill_id::text                                             AS src_id,
    'committee'::text                                         AS dst_kind,
    COALESCE(committee_code, committee_name)::text            AS dst_id,
    'bill_referred_to_committee'::text                        AS edge_type,
    1.0::float                                                AS confidence,
    'congress.gov'::text                                      AS source,
    NULL::timestamptz                                         AS observed_at,
    NULL::uuid                                                AS tenant_id
  FROM congress_bill_committee

  UNION ALL
  -- Bill → subject (one edge per subject row).
  SELECT
    'bill'::text, bill_id::text, 'subject'::text, name::text,
    'bill_about_subject'::text, 1.0::float, 'congress.gov'::text, NULL::timestamptz, NULL::uuid
  FROM congress_bill_subject

  UNION ALL
  -- Bill → policy area (the canonical single tag from Congress.gov).
  SELECT
    'bill'::text, id::text, 'policy_area'::text, policy_area::text,
    'bill_policy_area'::text, 1.0::float, 'congress.gov'::text, NULL::timestamptz, NULL::uuid
  FROM congress_bill
  WHERE policy_area IS NOT NULL

  UNION ALL
  -- Bill → sponsor. We don't yet have a members table, so we key by
  -- sponsor_name. Once a members table lands, swap the dst_id to its UUID.
  SELECT
    'bill'::text, id::text, 'member'::text, sponsor_name::text,
    'bill_sponsored_by'::text, 1.0::float, 'congress.gov'::text,
    latest_action_date::timestamptz, NULL::uuid
  FROM congress_bill
  WHERE sponsor_name IS NOT NULL

  UNION ALL
  -- LDA filing → client (the registrant filed on behalf of this client).
  SELECT
    'lda_filing', id::text, 'lda_client', client_id::text,
    'filing_for_client', 1.0, 'senate.gov_lda', dt_posted, NULL::uuid
  FROM lda_filing
  WHERE client_id IS NOT NULL

  UNION ALL
  -- LDA filing → registrant (the lobbying firm).
  SELECT
    'lda_filing', id::text, 'lda_registrant', registrant_id::text,
    'filing_by_registrant', 1.0, 'senate.gov_lda', dt_posted, NULL::uuid
  FROM lda_filing
  WHERE registrant_id IS NOT NULL

  UNION ALL
  -- LDA filing → issue code (one edge per unnested code).
  SELECT
    'lda_filing', f.id::text, 'lda_issue_code', code,
    'filing_on_issue', 1.0, 'senate.gov_lda', f.dt_posted, NULL::uuid
  FROM lda_filing f, unnest(f.issue_codes) AS code
  WHERE array_length(f.issue_codes, 1) > 0

  UNION ALL
  -- Lobbyist → registrant (career attribution; registrant_ids is an int[]).
  SELECT
    'lda_lobbyist', l.id::text, 'lda_registrant', r_id::text,
    'lobbyist_at_registrant', 1.0, 'senate.gov_lda', l.last_synced_at, NULL::uuid
  FROM lda_lobbyist l, unnest(l.registrant_ids) AS r_id

  UNION ALL
  -- FEC contribution → committee.
  SELECT
    'fec_contribution', id::text, 'fec_committee', committee_id,
    'contribution_to_committee', 1.0, 'fec.gov',
    COALESCE(contribution_date::timestamptz, last_synced_at), NULL::uuid
  FROM fec_contribution

  UNION ALL
  -- FEC contribution → candidate (the receiving candidate).
  SELECT
    'fec_contribution', id::text, 'candidate', candidate_name,
    'contribution_to_candidate', 1.0, 'fec.gov',
    COALESCE(contribution_date::timestamptz, last_synced_at), NULL::uuid
  FROM fec_contribution
  WHERE candidate_name IS NOT NULL

  UNION ALL
  -- FEC contribution → contributor employer. This is the most important
  -- join target for cross-domain queries: it's where money flow meets
  -- corporate identity (and bridges into client_intel_mapping via 'fec').
  SELECT
    'fec_contribution', id::text, 'employer', contributor_employer,
    'contribution_from_employer', 1.0, 'fec.gov',
    COALESCE(contribution_date::timestamptz, last_synced_at), NULL::uuid
  FROM fec_contribution
  WHERE contributor_employer IS NOT NULL

  UNION ALL
  -- Hearing → committee (forward calendar layer).
  SELECT
    'hearing'::text, id::text, 'committee'::text, COALESCE(committee_code, committee_name)::text,
    'hearing_of_committee'::text, 1.0::float, 'house.gov'::text, date::timestamptz, NULL::uuid
  FROM committee_hearing

  UNION ALL
  -- Federal Register doc → agency (one edge per agency name).
  SELECT
    'fr_document'::text, f.id::text, 'agency'::text, agency::text,
    'frdoc_by_agency'::text, 1.0::float, 'federalregister.gov'::text,
    f.publication_date::timestamptz, NULL::uuid
  FROM federal_register_document f, unnest(f.agency_names) AS agency

  UNION ALL
  -- Regulatory docket → agency.
  SELECT
    'docket'::text, id::text, 'agency'::text, agency_id::text,
    'docket_at_agency'::text, 1.0::float, 'regulations.gov'::text,
    COALESCE(posted_date::timestamptz, last_modified, synced_at), NULL::uuid
  FROM regulatory_docket

  UNION ALL
  -- FARA registrant → foreign principal.
  SELECT
    'fara_registrant'::text, registration_number::text, 'foreign_principal'::text, foreign_principal::text,
    'fara_represents'::text, 1.0::float, 'fara.gov'::text,
    COALESCE(registration_date::timestamptz, synced_at), NULL::uuid
  FROM fara_registration

  UNION ALL
  -- SEC filing → company (by CIK).
  SELECT
    'sec_filing'::text, id::text, 'sec_company'::text, cik::text,
    'sec_filing_by'::text, 1.0::float, 'sec.gov'::text,
    filing_date::timestamptz, NULL::uuid
  FROM sec_filing;

-- ----------------------------------------------------------------------------
-- TENANT OVERLAY ZONE
-- All edges originate from tables that are RLS-protected. We rely on the
-- base-table policies (USING: rls_bypass() OR tenant_id = current_tenant_id())
-- to do the filtering for us — every query against kg_tenant_edges already
-- sees a tenant-scoped slice without the function layer doing extra work.
--
-- Note the JOIN against `clients` in the first SELECT: client_intel_mapping
-- does not carry its own tenant_id, so we inherit it through clients.id.
-- If RLS hides the parent client, the JOIN drops the mapping row entirely,
-- which is the safer-by-default behavior (vs leaking the mapping with a
-- NULL tenant_id).
-- ----------------------------------------------------------------------------
CREATE VIEW kg_tenant_edges AS
  -- Tenant client → external mapping. Bridges into canonical IDs.
  SELECT
    'client'::text                          AS src_kind,
    c.id::text                              AS src_id,
    (CASE m.source
       WHEN 'lda'         THEN 'lda_client'
       WHEN 'fec'         THEN 'employer'
       WHEN 'contracting' THEN 'federal_contractor'
       WHEN 'lobby_intel' THEN 'lobby_intel'
       ELSE m.source
     END)::text                             AS dst_kind,
    m.external_id::text                     AS dst_id,
    ('client_mapped_to_' || m.source)::text AS edge_type,
    m.confidence::float                     AS confidence,
    (CASE WHEN m.confirmed THEN 'manual_confirmed' ELSE 'auto_matched' END)::text AS source,
    m.updated_at                            AS observed_at,
    c.tenant_id                             AS tenant_id
  FROM client_intel_mapping m
  JOIN clients c ON c.id = m.client_id

  UNION ALL
  -- Client → capability (tenant_id + RLS already on client_capabilities).
  SELECT
    'client'::text, client_id::text, 'capability'::text, id::text,
    'client_has_capability'::text, 1.0::float, 'tenant'::text, updated_at, tenant_id
  FROM client_capabilities

  UNION ALL
  -- Capability → program element (PE codes are the join into NDAA / approps).
  SELECT
    'capability'::text, id::text, 'program_element'::text, pe_number::text,
    'capability_under_pe'::text, 1.0::float, 'tenant'::text, updated_at, tenant_id
  FROM client_capabilities
  WHERE pe_number IS NOT NULL

  UNION ALL
  -- Meeting → client. association_score becomes confidence so the AI's
  -- auto-association strength flows through to KG callers.
  SELECT
    'meeting', id::text, 'client', client_id::text,
    'meeting_with_client',
    COALESCE(association_score, 1.0)::float,
    COALESCE(association_reason, 'tenant'),
    updated_at, tenant_id
  FROM meetings
  WHERE client_id IS NOT NULL

  UNION ALL
  -- Mail thread → client.
  SELECT
    'mail_thread', id::text, 'client', client_id::text,
    'mail_thread_with_client', 1.0, 'tenant', updated_at, tenant_id
  FROM mail_threads
  WHERE client_id IS NOT NULL

  UNION ALL
  -- Manual association overrides. By convention these WIN on conflict; the
  -- API layer is responsible for applying that precedence when multiple
  -- edges target the same (src, dst) pair.
  SELECT
    entity_type::text, entity_id::text, 'client', client_id::text,
    'manually_associated_to_client', 1.0, 'manual_override',
    created_at, tenant_id
  FROM client_association_overrides;

-- ----------------------------------------------------------------------------
-- COMBINED EDGE VIEW
-- ----------------------------------------------------------------------------
CREATE VIEW kg_edges AS
  SELECT src_kind, src_id, dst_kind, dst_id, edge_type, confidence,
         source, observed_at, tenant_id
    FROM kg_canonical_edges
  UNION ALL
  SELECT src_kind, src_id, dst_kind, dst_id, edge_type, confidence,
         source, observed_at, tenant_id
    FROM kg_tenant_edges;

-- ----------------------------------------------------------------------------
-- kg_neighbors — single-hop traversal in either direction.
--
-- Usage:
--   SELECT * FROM kg_neighbors('client', '<uuid>');
--   SELECT * FROM kg_neighbors('committee', 'HSAS', ARRAY['hearing_of_committee']);
--   SELECT * FROM kg_neighbors('lda_client', '12345', NULL, 'in');  -- who points at me
--
-- p_direction: 'out' = outgoing (default), 'in' = incoming, 'both' = union.
-- p_edge_types: optional whitelist of edge_type strings.
--
-- Tenant scoping is enforced by the underlying tables' RLS policies. No
-- additional filtering needed here.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kg_neighbors(
  p_kind        text,
  p_id          text,
  p_edge_types  text[]  DEFAULT NULL,
  p_direction   text    DEFAULT 'out'
)
RETURNS TABLE (
  src_kind     text,
  src_id       text,
  dst_kind     text,
  dst_id       text,
  edge_type    text,
  confidence   float,
  source       text,
  observed_at  timestamptz,
  tenant_id    uuid
)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT
    e.src_kind, e.src_id, e.dst_kind, e.dst_id,
    e.edge_type, e.confidence, e.source, e.observed_at, e.tenant_id
  FROM kg_edges e
  WHERE
    (p_edge_types IS NULL OR e.edge_type = ANY(p_edge_types))
    AND (
      (p_direction IN ('out', 'both') AND e.src_kind = p_kind AND e.src_id = p_id)
      OR
      (p_direction IN ('in', 'both')  AND e.dst_kind = p_kind AND e.dst_id = p_id)
    );
$$;

-- ----------------------------------------------------------------------------
-- kg_walk — bounded BFS up to N hops from a starting node.
-- Same RLS semantics as kg_neighbors. Cap p_max_depth in the API layer (3 is
-- plenty for the canonical bridges; deeper traversal on dense subgraphs like
-- bill→subject→bill can explode quickly).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kg_walk(
  p_kind        text,
  p_id          text,
  p_max_depth   int    DEFAULT 2,
  p_edge_types  text[] DEFAULT NULL
)
RETURNS TABLE (
  depth        int,
  src_kind     text,
  src_id       text,
  dst_kind     text,
  dst_id       text,
  edge_type    text,
  confidence   float,
  source       text,
  observed_at  timestamptz,
  tenant_id    uuid
)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  WITH RECURSIVE walk AS (
    SELECT
      1                       AS depth,
      e.src_kind, e.src_id, e.dst_kind, e.dst_id,
      e.edge_type, e.confidence, e.source, e.observed_at, e.tenant_id
    FROM kg_edges e
    WHERE e.src_kind = p_kind AND e.src_id = p_id
      AND (p_edge_types IS NULL OR e.edge_type = ANY(p_edge_types))

    UNION ALL

    SELECT
      w.depth + 1,
      e.src_kind, e.src_id, e.dst_kind, e.dst_id,
      e.edge_type, e.confidence, e.source, e.observed_at, e.tenant_id
    FROM walk w
    JOIN kg_edges e
      ON e.src_kind = w.dst_kind AND e.src_id = w.dst_id
    WHERE w.depth < p_max_depth
      AND (p_edge_types IS NULL OR e.edge_type = ANY(p_edge_types))
  )
  SELECT * FROM walk;
$$;

-- ----------------------------------------------------------------------------
-- Indexes that materially help kg_edges traversal. Most underlying tables
-- already have what they need (PKs, plus the indexes attached to each model
-- in schema.prisma). These add the lookups that the cross-domain bridges
-- exercise heavily and that are not already covered.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS client_intel_mapping_source_external_idx
  ON client_intel_mapping (source, external_id);

CREATE INDEX IF NOT EXISTS client_capabilities_pe_number_lookup_idx
  ON client_capabilities (pe_number)
  WHERE pe_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS fec_contribution_employer_lower_idx
  ON fec_contribution (lower(contributor_employer))
  WHERE contributor_employer IS NOT NULL;

CREATE INDEX IF NOT EXISTS congress_bill_committee_committee_name_idx
  ON congress_bill_committee (committee_name);

CREATE INDEX IF NOT EXISTS meetings_client_id_lookup_idx
  ON meetings (client_id)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mail_threads_client_id_lookup_idx
  ON mail_threads (client_id)
  WHERE client_id IS NOT NULL;
