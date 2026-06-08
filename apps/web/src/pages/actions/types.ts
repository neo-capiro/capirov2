/**
 * Web-side mirror of the Step 3.2 ActionRecommendation API contract (plan §10 card,
 * §19 workflow, §12.4 board). These unions/interfaces are kept BYTE-FOR-BYTE in step
 * with the API's `ActionCardDto` and the pure foundation types
 * (`apps/api/src/intelligence/actions/action-recommendation.types.ts`). The web tree
 * cannot import server code, so we re-declare the shapes here; do not let them drift.
 */

/** The kind of action a card recommends. Mirrors API ActionType. */
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

/** Workflow state of a card (plan §19). Mirrors API ActionStatus. */
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

/** Where a card's deadline comes from. `null` renders as "No known deadline". */
export type DeadlineSource = 'sam_response' | 'markup_window' | 'hearing' | 'manual';

/** Suggested deliverable type for the action. */
export type ArtifactType =
  | 'internal_brief'
  | 'client_email'
  | 'member_one_pager'
  | 'committee_staff_memo'
  | 'talking_points'
  | 'procurement_watch_note';

export type ConfidenceBand = 'high' | 'medium' | 'low';

/** A single recommended outreach target. */
export interface AudienceMember {
  kind: 'committee' | 'office' | 'person_role';
  id: string;
  label: string;
  contactUse?: string;
  /**
   * Whether this member is outreach/lobbying-eligible (`true`) vs context-only (`false`).
   * Mirrors the API field. Auto-generated person members are context-only until a human
   * designates a lobbying contact. Absent => not assessed (treated as context-only in UI).
   */
  outreachEligible?: boolean;
}

/** A pointer to supporting evidence for a card. */
export interface EvidenceRef {
  kind: 'source' | 'delta' | 'provision' | 'opportunity';
  sourceDocumentId?: string;
  page?: number;
  deltaId?: string;
  provisionId?: string;
  opportunityId?: string;
  note?: string;
}

/** Per-dimension confidence bands for a card. */
export interface ConfidenceBands {
  delta?: ConfidenceBand;
  programMatch?: ConfidenceBand;
  peopleMatch?: ConfidenceBand;
  clientRelevance?: ConfidenceBand;
}

/**
 * The full action card row returned by the API (`ActionCardDto`). Optional / nullable
 * fields are typed defensively: the UI must never crash on missing nested data.
 */
export interface ActionCardDto {
  id: string;
  clientId: string;
  clientName?: string | null;
  peCode: string | null;
  programId: string | null;
  deltaId: string | null;
  actionType: ActionType;
  issueTitle: string;
  whatChanged: string;
  whyItMatters: string;
  recommendedAction: string;
  targetAudience: AudienceMember[];
  suggestedArtifactType: ArtifactType | null;
  deadline: string | null;
  deadlineSource: DeadlineSource | null;
  ownerUserId: string | null;
  priority: number;
  confidence: ConfidenceBands;
  uncertainty: string | null;
  evidence: EvidenceRef[];
  status: ActionStatus;
  dismissalReason: string | null;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Envelope for the list endpoint. */
export interface ActionListResponse {
  data: ActionCardDto[];
  total: number;
  page: number;
  limit: number;
}

export interface GenerateResponse {
  generated: number;
}

/** §19 legal next-states. Kept in step with the API's ALLOWED_TRANSITIONS. */
export const ALLOWED_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  new: ['triaged', 'dismissed'],
  triaged: ['assigned', 'dismissed'],
  assigned: ['drafting', 'dismissed'],
  drafting: ['ready_for_review', 'dismissed'],
  ready_for_review: ['sent_to_client', 'drafting', 'dismissed'],
  sent_to_client: ['outreach_completed', 'monitoring', 'dismissed'],
  outreach_completed: ['monitoring', 'archived'],
  monitoring: ['archived', 'dismissed'],
  dismissed: ['triaged'],
  archived: [],
};

/** Human labels for each workflow status (kanban columns + status tags). */
export const STATUS_LABELS: Record<ActionStatus, string> = {
  new: 'New',
  triaged: 'Triaged',
  assigned: 'Assigned',
  drafting: 'Drafting',
  ready_for_review: 'Ready for Review',
  sent_to_client: 'Sent to Client',
  outreach_completed: 'Outreach Completed',
  monitoring: 'Monitoring',
  dismissed: 'Dismissed',
  archived: 'Archived',
};

/** Stable kanban column order (left → right through the §19 lifecycle). */
export const STATUS_ORDER: ActionStatus[] = [
  'new',
  'triaged',
  'assigned',
  'drafting',
  'ready_for_review',
  'sent_to_client',
  'outreach_completed',
  'monitoring',
  'dismissed',
  'archived',
];

export const STATUS_TAG_COLORS: Record<ActionStatus, string> = {
  new: 'blue',
  triaged: 'cyan',
  assigned: 'geekblue',
  drafting: 'purple',
  ready_for_review: 'gold',
  sent_to_client: 'green',
  outreach_completed: 'green',
  monitoring: 'lime',
  dismissed: 'default',
  archived: 'default',
};

/** Action-type display labels + tag colors for the badge on each card. */
export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  protect_funding: 'Protect Funding',
  restore_cut: 'Restore Cut',
  add_report_language: 'Add Report Language',
  oppose_restriction: 'Oppose Restriction',
  district_one_pager: 'District One-Pager',
  monitor_procurement: 'Monitor Procurement',
  client_alert: 'Client Alert',
  schedule_outreach: 'Schedule Outreach',
  escalate_uncertainty: 'Escalate Uncertainty',
  update_compliance_notes: 'Update Compliance Notes',
};

export const ACTION_TYPE_COLORS: Record<ActionType, string> = {
  protect_funding: 'green',
  restore_cut: 'red',
  add_report_language: 'blue',
  oppose_restriction: 'volcano',
  district_one_pager: 'geekblue',
  monitor_procurement: 'cyan',
  client_alert: 'gold',
  schedule_outreach: 'purple',
  escalate_uncertainty: 'magenta',
  update_compliance_notes: 'default',
};

export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  internal_brief: 'Internal Brief',
  client_email: 'Client Email',
  member_one_pager: 'Member One-Pager',
  committee_staff_memo: 'Committee Staff Memo',
  talking_points: 'Talking Points',
  procurement_watch_note: 'Procurement Watch Note',
};

export const DEADLINE_SOURCE_LABELS: Record<DeadlineSource, string> = {
  sam_response: 'SAM.gov response due',
  markup_window: 'Markup window',
  hearing: 'Hearing',
  manual: 'Manually set',
};

export const CONFIDENCE_BAND_COLORS: Record<ConfidenceBand, string> = {
  high: 'green',
  medium: 'gold',
  low: 'red',
};
