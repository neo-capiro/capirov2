/**
 * Materiality + relevance gating and de-duplication for action cards (plan §10).
 * Pure — no DB, no NestJS. A card is only generated when BOTH the budget change is
 * material enough AND the change is relevant enough to the specific client.
 */

import type { ActionType } from './action-recommendation.types.js';

/** Minimum materiality score (0..1) for a change to warrant an action. Inclusive. */
export const GATE_MATERIALITY_MIN = 0.4;

/** Minimum client-relevance score (0..1) for a change to warrant an action. Inclusive. */
export const GATE_RELEVANCE_MIN = 0.5;

/**
 * True when a change clears BOTH the materiality and relevance gates. Both
 * comparisons are inclusive (`>=`) so a score exactly at the threshold passes.
 */
export function shouldGenerate(input: {
  materialityScore: number;
  relevanceScore: number;
}): boolean {
  return (
    input.materialityScore >= GATE_MATERIALITY_MIN &&
    input.relevanceScore >= GATE_RELEVANCE_MIN
  );
}

/**
 * Stable de-duplication key for a card, matching the DB unique index semantics
 * (`tenant_id, client_id, COALESCE(delta_id, ''), action_type`). `deltaId` is
 * coalesced to `''` so cards not tied to a specific delta still de-dupe per
 * (client, action_type). The tenant is implied by RLS / scoping and is not part of
 * this key — callers compute it within a tenant context.
 */
export function dedupeKey(input: {
  clientId: string;
  deltaId?: string | null;
  actionType: ActionType;
}): string {
  const delta = input.deltaId ?? '';
  return `${input.clientId}|${delta}|${input.actionType}`;
}
