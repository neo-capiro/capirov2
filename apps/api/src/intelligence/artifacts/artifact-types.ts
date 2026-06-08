/**
 * Step 3.3 — source-backed artifact generation (plan §18).
 *
 * Pure type/interface declarations shared by the deterministic FactSheet builder,
 * the verifier gate, and the generator service. No DB, no NestJS, no runtime
 * behaviour. The contract here is the web layer's source of truth for the
 * artifact-generation chunk.
 *
 * Grounding model: a {@link FactSheet} is the closed set of {@link Claim}s an
 * artifact is allowed to assert. Every {@link GeneratedParagraph} the LLM returns
 * must reference one or more claim ids; the verifier rejects any paragraph that
 * asserts a number not present in a cited claim. This guarantees 100% source
 * backing — the prose can only restate claims, never invent facts.
 */

/**
 * The deliverable types an artifact can be generated as. Superset of the action
 * card's `suggestedArtifactType` (adds `client_email`); the card's suggestion is
 * only a default — the user picks the actual type at generation time.
 */
export type ArtifactType =
  | 'internal_brief'
  | 'client_email'
  | 'member_one_pager'
  | 'committee_staff_memo'
  | 'talking_points'
  | 'procurement_watch_note';

/**
 * A pointer back to the underlying evidence that grounds a {@link Claim}. Mirrors
 * the action card's `EvidenceRef` vocabulary (source/delta/provision/opportunity)
 * so a claim's provenance can be rendered as a human citation in the Sources
 * appendix. `note` carries a free-text label (e.g. the doc title) when present.
 */
export interface ClaimSourceRef {
  kind: 'source' | 'delta' | 'provision' | 'opportunity' | 'narrative';
  sourceDocumentId?: string;
  page?: number;
  deltaId?: string;
  provisionId?: string;
  opportunityId?: string;
  note?: string;
}

/**
 * A single, typed, source-backed assertion. `claimText` is the human-readable
 * statement; `value` (when present) is the canonical numeric/string figure the
 * claim carries (e.g. "$120M") so the verifier can check generated prose against
 * it. Ids are stable within a fact sheet (c1, c2, ...).
 */
export interface Claim {
  id: string;
  claimText: string;
  value?: string;
  sourceRef: ClaimSourceRef;
}

/** The closed set of claims an artifact is permitted to assert. */
export interface FactSheet {
  claims: Claim[];
}

/**
 * One paragraph of generated prose plus the ids of the claims it draws on. The
 * verifier requires `claimIds` to be non-empty and every numeral in `text` to be
 * traceable to a cited claim.
 */
export interface GeneratedParagraph {
  text: string;
  claimIds: string[];
}
