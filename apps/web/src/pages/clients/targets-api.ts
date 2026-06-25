import type { AxiosInstance } from 'axios';

/**
 * Web API for Client Targets (CRUD) + Office Recommender (Meri suggestions).
 *
 * Mirrors apps/api/src/clients/client-targets.controller.ts (mounted at
 * /api/clients/:clientId/targets) and the office recommender surfaced inside the
 * client profile-v1 aggregate (relationships.officeRecommender).
 *
 * member_id is the congressional directory member id (DirectoryEntry.id /
 * bioguide) — the directory is an in-memory S3 snapshot, not a DB table, so the
 * row denormalizes a compact member snapshot at add time.
 */

export type TargetSource = 'manual' | 'meri';

export interface ClientTarget {
  id: string;
  clientId: string;
  memberId: string;
  memberName: string | null;
  party: 'R' | 'D' | 'I' | null;
  /** Senate: "TX"; House: "TX-12". */
  state: string | null;
  chamber: 'House' | 'Senate' | null;
  committee: string | null;
  source: TargetSource;
  addedByUserId: string | null;
  addedAt: string;
}

/** A single Meri office recommendation (read from the intel aggregate). */
export interface OfficeRecommendation {
  memberId: string;
  office: string;
  party: 'R' | 'D' | 'I' | null;
  state: string | null;
  chamber: 'House' | 'Senate' | null;
  committee: string | null;
  score: number;
  tags: string[];
  billCount: number;
}

export async function getClientTargets(
  api: AxiosInstance,
  clientId: string,
): Promise<ClientTarget[]> {
  return (
    await api.get<ClientTarget[]>(`/api/clients/${encodeURIComponent(clientId)}/targets`)
  ).data;
}

export async function addClientTarget(
  api: AxiosInstance,
  clientId: string,
  memberId: string,
  source: TargetSource,
): Promise<ClientTarget> {
  return (
    await api.post<ClientTarget>(`/api/clients/${encodeURIComponent(clientId)}/targets`, {
      memberId,
      source,
    })
  ).data;
}

export async function removeClientTarget(
  api: AxiosInstance,
  clientId: string,
  memberId: string,
): Promise<{ deleted: true }> {
  return (
    await api.delete<{ deleted: true }>(
      `/api/clients/${encodeURIComponent(clientId)}/targets/${encodeURIComponent(memberId)}`,
    )
  ).data;
}
