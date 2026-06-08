/**
 * React-query hooks for the Step 3.2 ActionRecommendation API (plan §12.4 board).
 * Wraps the contract endpoints exactly:
 *   GET   /api/intelligence/actions
 *   GET   /api/intelligence/actions/:id
 *   PATCH /api/intelligence/actions/:id/status
 *   PATCH /api/intelligence/actions/:id/owner
 *   POST  /api/intelligence/actions/generate
 * All requests go through the tenant-scoped axios client (`useApi`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import type {
  ActionCardDto,
  ActionListResponse,
  ActionStatus,
  GenerateResponse,
} from './types.js';

const BASE = '/api/intelligence/actions';

export interface ActionListParams {
  status?: ActionStatus;
  clientId?: string;
  sort?: 'deadline' | 'priority';
  page?: number;
  limit?: number;
}

export const actionsQueryKey = (params: ActionListParams) =>
  ['intel-actions', params] as const;

/** GET /api/intelligence/actions — the paginated, sortable list. */
export function useActionsList(params: ActionListParams) {
  const api = useApi();
  return useQuery<ActionListResponse>({
    queryKey: actionsQueryKey(params),
    queryFn: async () =>
      (
        await api.get<ActionListResponse>(BASE, {
          params: {
            ...(params.status ? { status: params.status } : {}),
            ...(params.clientId ? { clientId: params.clientId } : {}),
            ...(params.sort ? { sort: params.sort } : {}),
            ...(params.page ? { page: params.page } : {}),
            ...(params.limit ? { limit: params.limit } : {}),
          },
        })
      ).data,
    staleTime: 30_000,
  });
}

/** POST /api/intelligence/actions/generate — runs the generator for the caller tenant. */
export function useGenerateActions() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<GenerateResponse, Error>({
    mutationFn: async () =>
      (await api.post<GenerateResponse>(`${BASE}/generate`)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['intel-actions'] });
    },
  });
}

export interface StatusChangeInput {
  id: string;
  status: ActionStatus;
  dismissalReason?: string;
}

/** PATCH /api/intelligence/actions/:id/status — routed through validateTransition server-side. */
export function useUpdateActionStatus() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<ActionCardDto, Error, StatusChangeInput>({
    mutationFn: async ({ id, status, dismissalReason }) =>
      (
        await api.patch<ActionCardDto>(`${BASE}/${id}/status`, {
          status,
          ...(dismissalReason ? { dismissalReason } : {}),
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['intel-actions'] });
    },
  });
}

export interface OwnerChangeInput {
  id: string;
  ownerUserId: string | null;
}

/** PATCH /api/intelligence/actions/:id/owner — assign / clear the owner. */
export function useUpdateActionOwner() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<ActionCardDto, Error, OwnerChangeInput>({
    mutationFn: async ({ id, ownerUserId }) =>
      (await api.patch<ActionCardDto>(`${BASE}/${id}/owner`, { ownerUserId })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['intel-actions'] });
    },
  });
}

export interface TeamMemberOption {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Owner-assignment candidates. Reuses the tenant-admin team roster the Team page
 * already exposes; best-effort (an empty roster degrades to a free "Unassign"
 * control, never a crash).
 */
export function useTeamMembers() {
  const api = useApi();
  return useQuery<TeamMemberOption[]>({
    // Sibling namespace — must NOT share the 'intel-actions' prefix, or the card mutations'
    // invalidateQueries({ queryKey: ['intel-actions'] }) would prefix-match and needlessly
    // refetch the roster (flashing the owner Select empty after every mutation).
    queryKey: ['tenant-team-members'],
    queryFn: async () => {
      try {
        const rows = (await api.get<TeamMemberOption[]>('/api/tenant-admin/team')).data;
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}
