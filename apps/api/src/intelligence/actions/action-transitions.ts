/**
 * Workflow-state transition rules for action cards (plan §19). Pure — no DB, no
 * NestJS. The generator/API layers call `validateTransition` before persisting any
 * status change so the §19 lifecycle is enforced in exactly one place.
 */

import type { ActionStatus } from './action-recommendation.types.js';

/**
 * Legal next-states for each status (plan §19). A status whose array is empty is
 * terminal. Note: `dismissed -> triaged` is the explicit reopen path; `archived`
 * is terminal.
 */
export const ALLOWED_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  new: ['triaged', 'dismissed'],
  triaged: ['assigned', 'dismissed'],
  assigned: ['drafting', 'dismissed'],
  drafting: ['ready_for_review', 'dismissed'],
  ready_for_review: ['sent_to_client', 'drafting', 'dismissed'],
  sent_to_client: ['outreach_completed', 'monitoring', 'dismissed'],
  outreach_completed: ['monitoring', 'archived'],
  monitoring: ['archived', 'dismissed'],
  dismissed: ['triaged'], // reopen
  archived: [], // terminal
};

export interface ValidateTransitionResult {
  ok: boolean;
  error?: string;
}

/**
 * Validate a proposed status change.
 *
 * Rejects any transition not present in {@link ALLOWED_TRANSITIONS}. When the target
 * status is `'dismissed'`, a non-empty `dismissalReason` is required (we never dismiss
 * a card silently).
 */
export function validateTransition(
  from: ActionStatus,
  to: ActionStatus,
  opts: { dismissalReason?: string } = {},
): ValidateTransitionResult {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error: `Illegal transition: ${from} -> ${to}`,
    };
  }

  if (to === 'dismissed' && !opts.dismissalReason?.trim()) {
    return {
      ok: false,
      error: 'A dismissal reason is required when dismissing an action.',
    };
  }

  return { ok: true };
}
