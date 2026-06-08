/**
 * Audience selection for action cards (plan §17 contact-use guardrail + §7 quarantine
 * rule). Pure — no DB, no NestJS. Decides WHO may appear as an outreach target on a
 * card, and forces an `escalate_uncertainty` action when the card depends on an
 * unconfirmed (candidate/quarantined) program match.
 *
 * This module is the single chokepoint that reuses the 2.2 contact-use policy so the
 * FAR-derived "procurement officials are never lobbying targets" rule is enforced in
 * exactly one place.
 */

import {
  isExcludedFromRecommendations,
  isLobbyingEligible,
  type ContactUse,
} from '../../acquisition-personnel/contact-use.policy.js';
import type { AudienceMember } from './action-recommendation.types.js';

export interface AudiencePersonRole {
  id: string;
  label: string;
  /** §17 contact-use classification (a `ContactUse` value). */
  contactUse: string;
  reviewStatus: string;
  /** ISO timestamp when the role went stale; truthy => excluded from audience. */
  staleAt?: string | null;
}

export interface AudienceCommittee {
  id: string;
  label: string;
}

export interface SelectAudienceInput {
  personRoles: AudiencePersonRole[];
  committees: AudienceCommittee[];
  /** Review statuses of the program matches this card relies on. */
  matchStatuses: string[];
}

export interface SelectAudienceResult {
  audience: AudienceMember[];
  /** Set when the card depends on an unconfirmed match and must be escalated. */
  forcedActionType?: 'escalate_uncertainty';
  uncertaintyNotes: string[];
}

/** Match statuses that mean "this match is not confirmed and cannot be relied on." */
const UNCONFIRMED_MATCH_STATUSES = new Set(['candidate', 'quarantined']);

/**
 * Build the lobbying/outreach audience for a card.
 *
 * Rules:
 *  - A person is EXCLUDED from the audience if their contact-use satisfies
 *    {@link isExcludedFromRecommendations} (official_procurement_poc,
 *    do_not_contact_procurement_sensitive, quarantined, candidate). These people are
 *    never outreach targets — they may appear elsewhere as context, never here.
 *  - A person whose role is stale (`staleAt` set) is excluded.
 *  - Committees are always permitted as audience members.
 *  - If ANY relied-upon program match is `candidate` or `quarantined`, the card is
 *    forced to `escalate_uncertainty` and an uncertainty note names the dependency
 *    (plan §7: quarantined matches are never used in recommendations).
 */
export function selectAudience(input: SelectAudienceInput): SelectAudienceResult {
  const uncertaintyNotes: string[] = [];

  const audience: AudienceMember[] = [];

  for (const role of input.personRoles) {
    if (isExcludedFromRecommendations(role.contactUse as ContactUse)) {
      continue;
    }
    if (role.staleAt) {
      continue;
    }
    // Mark whether the person is actually lobbying/outreach-eligible vs context-only.
    // NOTE: classifyContactUse never auto-produces 'lobbying_contact', so auto-generated
    // person members are context-only (outreachEligible: false) until a human explicitly
    // designates a lobbying contact — this is intentional.
    audience.push({
      kind: 'person_role',
      id: role.id,
      label: role.label,
      contactUse: role.contactUse,
      outreachEligible: isLobbyingEligible(role.contactUse as ContactUse),
    });
  }

  // Committees are always allowed (treated as a valid outreach channel).
  for (const committee of input.committees) {
    audience.push({
      kind: 'committee',
      id: committee.id,
      label: committee.label,
      outreachEligible: true,
    });
  }

  // §7: if the card leans on any unconfirmed match, escalate rather than recommend.
  const unconfirmed = input.matchStatuses.filter((s) =>
    UNCONFIRMED_MATCH_STATUSES.has(s),
  );
  let forcedActionType: 'escalate_uncertainty' | undefined;
  if (unconfirmed.length > 0) {
    forcedActionType = 'escalate_uncertainty';
    const summary = unconfirmed.join(', ');
    uncertaintyNotes.push(
      `Card relies on an unconfirmed program match (status: ${summary}); ` +
        'confirm the match before acting.',
    );
  }

  return { audience, forcedActionType, uncertaintyNotes };
}
