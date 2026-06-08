/**
 * React-query hooks for the Step 3.4 relationship-coverage API.
 * Wraps the contract endpoints exactly:
 *   GET  /api/intelligence/actions/:id/coverage          -> CoverageResult
 *   GET  /api/intelligence/clients/:clientId/coverage    -> CoverageResult  (peCode REQUIRED)
 *   POST /api/intelligence/coverage/outreach             -> { id, created, status }
 * All requests go through the tenant-scoped axios client (`useApi`).
 *
 * The coverage query key is its OWN namespace (`['action-coverage', actionId]`) so it does
 * NOT prefix-collide with the card mutations' invalidateQueries({ queryKey: ['intel-actions'] }).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';

const BASE = '/api/intelligence';

/** Relationship strength of a coverage entry. */
export type CoverageStrength = 'active' | 'warm' | 'cold' | 'none';

/** A single office/person coverage row. Optional fields are defensive — never crash on a thin row. */
export interface CoverageEntry {
  officeId: string;
  officeName: string;
  personId?: string;
  personName?: string;
  roleTitle?: string;
  contactUse: string;
  contactUseLabel: string;
  lastTouch: string | null;
  owner: string | null;
  strength: CoverageStrength;
  outreachEligible: boolean;
}

/** The full coverage payload returned by the action / client coverage endpoints. */
export interface CoverageResult {
  peCode: string;
  clientId?: string;
  strong: CoverageEntry[];
  weak: CoverageEntry[];
  none: CoverageEntry[];
  whyNow?: { whatChanged: string; deadline: string | null };
}

/** The coverage query key — kept in its own namespace (see file header). */
export const actionCoverageQueryKey = (actionId: string) =>
  ['action-coverage', actionId] as const;

/**
 * GET /api/intelligence/actions/:id/coverage — relationship coverage for ONE action.
 * Disabled until `enabled` is true so the board can fetch lazily (only when a card's
 * coverage sub-section is expanded), never once-per-card on the kanban.
 */
export function useActionCoverage(actionId: string, enabled: boolean) {
  const api = useApi();
  return useQuery<CoverageResult>({
    queryKey: actionCoverageQueryKey(actionId),
    enabled: enabled && Boolean(actionId),
    queryFn: async () =>
      (await api.get<CoverageResult>(`${BASE}/actions/${actionId}/coverage`)).data,
    staleTime: 30_000,
  });
}

export interface CreateOutreachInput {
  /** Identify the source — at least one of actionId / (peCode + clientId) per the contract. */
  actionId?: string;
  peCode?: string;
  clientId?: string;
  /** The targeted office (always required). */
  officeId: string;
  /** Omit for office-only gap rows (no specific person). */
  personId?: string;
  /** Who owns the resulting outreach action. */
  ownerUserId: string;
}

export interface CreateOutreachResponse {
  id: string;
  created: boolean;
  status: string;
}

/**
 * POST /api/intelligence/coverage/outreach — assign an owner + spin up an outreach action
 * for a coverage gap. On success invalidates the actions list (a new action may appear) and
 * the originating action's coverage (the gap should reflect the new touch/owner).
 */
export function useCreateOutreach() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<CreateOutreachResponse, Error, CreateOutreachInput>({
    mutationFn: async (input) =>
      (
        await api.post<CreateOutreachResponse>(`${BASE}/coverage/outreach`, {
          ...(input.actionId ? { actionId: input.actionId } : {}),
          ...(input.peCode ? { peCode: input.peCode } : {}),
          ...(input.clientId ? { clientId: input.clientId } : {}),
          officeId: input.officeId,
          ...(input.personId ? { personId: input.personId } : {}),
          ownerUserId: input.ownerUserId,
        })
      ).data,
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ['intel-actions'] });
      if (input.actionId) {
        void qc.invalidateQueries({ queryKey: actionCoverageQueryKey(input.actionId) });
      }
    },
  });
}
