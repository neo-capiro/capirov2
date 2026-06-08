import type { AxiosInstance } from 'axios';

/**
 * Step 2.3 — web API for explainable client ⇄ Program-Element relevance.
 *
 * Mirrors the read endpoints on apps/api/src/intelligence/client-pe-relevance.controller.ts:
 *   GET /api/intelligence/clients/:clientId/pe-relevance   → PEs relevant to a client (paginated)
 *   GET /api/intelligence/program-elements/:peCode/client-relevance → tenant clients relevant to a PE
 *
 * Every call carries the `/api/` prefix (the web client does not prepend it). Types mirror the
 * pure scoring module's RelevancePath/PathResult and the service response shapes verbatim.
 */

/** The distinct evidence paths by which a client can be relevant to a PE. */
export type RelevancePath =
  | 'capability_pe_direct'
  | 'capability_keyword'
  | 'prior_award'
  | 'facility_district'
  | 'ecosystem';

/** One scored evidence path with its human-readable supporting evidence lines. */
export interface PathResult {
  path: RelevancePath;
  score: number;
  evidence: string[];
}

/** A PE relevant to a client, scored + explained. */
export interface RelevantPeRow {
  peCode: string;
  title: string | null;
  score: number;
  paths: PathResult[];
}

/** Paginated PEs-for-client response (matches getRelevantPesForClient). */
export interface RelevantPesForClientResponse {
  data: RelevantPeRow[];
  total: number;
  page: number;
  limit: number;
}

/** A client (within the caller's tenant) relevant to a PE, scored + explained. */
export interface RelevantClientRow {
  clientId: string;
  clientName: string;
  score: number;
  paths: PathResult[];
}

/** GET /api/intelligence/clients/:clientId/pe-relevance — PEs relevant to a client. */
export async function getRelevantPesForClient(
  api: AxiosInstance,
  clientId: string,
  params: { minScore?: number; page?: number; limit?: number } = {},
): Promise<RelevantPesForClientResponse> {
  return (
    await api.get<RelevantPesForClientResponse>(
      `/api/intelligence/clients/${encodeURIComponent(clientId)}/pe-relevance`,
      { params },
    )
  ).data;
}

/** GET /api/intelligence/program-elements/:peCode/client-relevance — tenant clients relevant to a PE. */
export async function getRelevantClientsForPe(
  api: AxiosInstance,
  peCode: string,
  params: { minScore?: number } = {},
): Promise<RelevantClientRow[]> {
  return (
    await api.get<RelevantClientRow[]>(
      `/api/intelligence/program-elements/${encodeURIComponent(peCode)}/client-relevance`,
      { params },
    )
  ).data;
}

// ── Shared presentational helpers (used by both relevance surfaces) ───────────

/** Friendly labels for each evidence path, for chips and legends. */
export const RELEVANCE_PATH_LABEL: Record<RelevancePath, string> = {
  capability_pe_direct: 'Capability lists PE',
  capability_keyword: 'Keyword match',
  prior_award: 'Prior award',
  facility_district: 'Facility district',
  ecosystem: 'Ecosystem',
};

/** Per-path chip color (antd Tag color tokens). */
export const RELEVANCE_PATH_COLOR: Record<RelevancePath, string> = {
  capability_pe_direct: 'green',
  capability_keyword: 'blue',
  prior_award: 'geekblue',
  facility_district: 'purple',
  ecosystem: 'cyan',
};

/** Score → coarse confidence band for the score badge color. */
export function scoreBandColor(score: number): string {
  if (score >= 0.8) return 'green';
  if (score >= 0.6) return 'gold';
  if (score >= 0.4) return 'orange';
  return 'default';
}

/** Format a 0..1 relevance score as a compact percentage label, e.g. "0.85" → "85%". */
export function formatScorePct(score: number): string {
  const n = Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0;
  return `${Math.round(n * 100)}%`;
}

/** Combine a bare district number + state into the "ST-NN" display form. */
export function formatDistrict(state: string | null | undefined, district: string | null | undefined): string {
  const st = (state ?? '').trim().toUpperCase();
  const dist = (district ?? '').trim();
  if (st && dist) return `${st}-${dist}`;
  return st || dist || '';
}
