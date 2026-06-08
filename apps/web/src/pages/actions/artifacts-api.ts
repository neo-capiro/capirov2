/**
 * React-query hooks for the Step 3.3 source-backed artifact API (plan §18).
 * Wraps the contract endpoints exactly:
 *   POST  /api/intelligence/actions/:id/artifacts   body { type }   -> GeneratedArtifact
 *   GET   /api/intelligence/actions/:id/artifacts                    -> GeneratedArtifact[] (newest first)
 *   PATCH /api/intelligence/artifacts/:id            body { bodyText } -> GeneratedArtifact
 * All requests go through the tenant-scoped axios client (`useApi`).
 *
 * The artifact list lives in its OWN query namespace (`['action-artifacts', actionId]`)
 * so it does NOT prefix-collide with the card mutations'
 * invalidateQueries({ queryKey: ['intel-actions'] }) nor the coverage namespace.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../lib/use-api.js';
import type { ArtifactType } from './types.js';

const BASE = '/api/intelligence';

/**
 * The web-side mirror of the API's `GeneratedArtifact` shape (kept byte-for-byte in step
 * with apps/api/src/intelligence/artifacts/artifact-generator.service.ts). Optional/nested
 * fields are treated defensively in the UI — never crash on a thin or malformed row.
 */
export interface ArtifactMetadata {
  actionId: string;
  claimIds: string[];
  verification: { ok: boolean; rejected: { index: number; reason: string }[] };
  version: number;
  artifactType: ArtifactType;
}

export interface GeneratedArtifact {
  id: string;
  title: string;
  /** `artifact_<type>` per the contract. */
  kind: string;
  bodyText: string;
  metadata: ArtifactMetadata;
}

/** The artifact-list query key — kept in its own namespace (see file header). */
export const actionArtifactsQueryKey = (actionId: string) =>
  ['action-artifacts', actionId] as const;

/**
 * GET /api/intelligence/actions/:id/artifacts — the artifacts generated for ONE action,
 * newest first. Disabled until `enabled` is true so the board can fetch lazily (only once
 * the card's Artifacts sub-section is expanded), never once-per-card on the kanban.
 */
export function useActionArtifacts(actionId: string, enabled: boolean) {
  const api = useApi();
  return useQuery<GeneratedArtifact[]>({
    queryKey: actionArtifactsQueryKey(actionId),
    enabled: enabled && Boolean(actionId),
    queryFn: async () => {
      const rows = (
        await api.get<GeneratedArtifact[]>(`${BASE}/actions/${actionId}/artifacts`)
      ).data;
      return Array.isArray(rows) ? rows : [];
    },
    staleTime: 30_000,
  });
}

export interface GenerateArtifactInput {
  actionId: string;
  type: ArtifactType;
}

/**
 * POST /api/intelligence/actions/:id/artifacts — generate a source-backed artifact of
 * `type`. On success invalidates this action's artifact list so the new artifact appears.
 */
export function useGenerateArtifact() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<GeneratedArtifact, Error, GenerateArtifactInput>({
    mutationFn: async ({ actionId, type }) =>
      (
        await api.post<GeneratedArtifact>(`${BASE}/actions/${actionId}/artifacts`, { type })
      ).data,
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: actionArtifactsQueryKey(input.actionId) });
    },
  });
}

export interface UpdateArtifactInput {
  /** The action the artifact belongs to — used to invalidate the right list. */
  actionId: string;
  artifactId: string;
  bodyText: string;
}

/**
 * PATCH /api/intelligence/artifacts/:id — persist a user edit as a new version (the server
 * never regenerates). On success invalidates this action's artifact list so the bumped
 * version + edited body are reflected.
 */
export function useUpdateArtifact() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation<GeneratedArtifact, Error, UpdateArtifactInput>({
    mutationFn: async ({ artifactId, bodyText }) =>
      (await api.patch<GeneratedArtifact>(`${BASE}/artifacts/${artifactId}`, { bodyText })).data,
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: actionArtifactsQueryKey(input.actionId) });
    },
  });
}
