/**
 * Shared types for the Step 3.2 ActionRecommendation engine (plan §10 card spec,
 * §19 workflow states). Pure type/union declarations — no DB, no NestJS, no runtime
 * behaviour. Mirrors the `action_recommendation` table columns so the generator
 * service and CRUD API can share one vocabulary.
 */

/** The kind of action a card recommends. Maps to `action_recommendation.action_type`. */
export type ActionType =
  | 'protect_funding'
  | 'restore_cut'
  | 'add_report_language'
  | 'oppose_restriction'
  | 'district_one_pager'
  | 'monitor_procurement'
  | 'client_alert'
  | 'schedule_outreach'
  | 'escalate_uncertainty'
  | 'update_compliance_notes';

/** Workflow state of a card (plan §19). Maps to `action_recommendation.status`. */
export type ActionStatus =
  | 'new'
  | 'triaged'
  | 'assigned'
  | 'drafting'
  | 'ready_for_review'
  | 'sent_to_client'
  | 'outreach_completed'
  | 'monitoring'
  | 'dismissed'
  | 'archived';

/**
 * Where a card's deadline comes from. `null` (no source) renders as
 * "no known deadline" in the UI.
 */
export type DeadlineSource = 'sam_response' | 'markup_window' | 'hearing' | 'manual';

/** Suggested deliverable type for the action. */
export type ArtifactType =
  | 'internal_brief'
  | 'client_email'
  | 'member_one_pager'
  | 'committee_staff_memo'
  | 'talking_points'
  | 'procurement_watch_note';

/** Confidence band shared by all confidence dimensions. */
export type ConfidenceBand = 'high' | 'medium' | 'low';

/**
 * A single recommended outreach target. `kind` distinguishes committees, member
 * offices, and individual program/relationship people. `contactUse` (when present)
 * carries the §17 contact-use classification for display badges.
 */
export interface AudienceMember {
  kind: 'committee' | 'office' | 'person_role';
  id: string;
  label: string;
  contactUse?: string;
  /**
   * Whether this member is actually lobbying/outreach-eligible (`true`) vs context-only
   * (`false`). Set for `person_role` members from the §17 contact-use policy. NOTE:
   * `classifyContactUse` never auto-produces `'lobbying_contact'`, so auto-generated person
   * audience members are context-only (`false`) until a human explicitly designates a
   * lobbying contact — this is intentional. Absent => not assessed.
   */
  outreachEligible?: boolean;
}

/**
 * A pointer to supporting evidence for a card. Exactly which optional id is set
 * depends on `kind` (e.g. a 'delta' ref carries `deltaId`, a 'source' ref carries
 * `sourceDocumentId` + optional `page`).
 */
export interface EvidenceRef {
  kind: 'source' | 'delta' | 'provision' | 'opportunity';
  sourceDocumentId?: string;
  page?: number;
  deltaId?: string;
  provisionId?: string;
  opportunityId?: string;
  note?: string;
}

/**
 * Per-dimension confidence bands for a card. Each dimension is optional; an absent
 * dimension means "not assessed". Stored in `action_recommendation.confidence_jsonb`.
 */
export interface ConfidenceBands {
  delta?: ConfidenceBand;
  programMatch?: ConfidenceBand;
  peopleMatch?: ConfidenceBand;
  clientRelevance?: ConfidenceBand;
}
