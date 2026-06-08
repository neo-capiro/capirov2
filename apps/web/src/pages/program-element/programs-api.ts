import type { AxiosInstance } from 'axios';

/**
 * Step 2.1 — web API for the Program graph (Program / ProgramAlias / PeProgramMatch).
 * Mirrors the program-centric backend in apps/api/src/program-element/programs/* plus the
 * thin PE-keyed read on the program-elements controller. Every call carries the `/api/`
 * prefix (the web client does not prepend it).
 */

export type ProgramMatchStatus = 'accepted' | 'candidate' | 'quarantined' | 'rejected';
export type ProgramConfidenceBand = 'high' | 'medium' | 'low' | 'weak';
export type ProgramMatchDecision = 'accept' | 'reject' | 'quarantine';

export interface ProgramSearchRow {
  id: string;
  canonicalName: string;
  component: string | null;
  mdapCode: string | null;
  status: string;
  bestAlias?: string;
  sim?: number;
}

export interface ProgramSearchResponse {
  data: ProgramSearchRow[];
  total: number;
  q: string;
}

export interface ProgramEvidenceItem {
  kind?: string;
  sourceUrl?: string;
  pageNumber?: number;
  quote?: string;
}

export interface ProgramMatchQueueRow {
  id: string;
  peCode: string;
  projectCode: string | null;
  programId: string;
  score: number;
  confidenceBand: ProgramConfidenceBand;
  evidenceTier: string;
  status: ProgramMatchStatus;
  matchBasis: string | null;
  whyShown: string;
  evidence: ProgramEvidenceItem[];
  programElement: { peCode: string; title: string; service: string | null } | null;
  program: { id: string; canonicalName: string; component: string | null; mdapCode: string | null } | null;
  createdAt: string;
}

export interface ProgramMatchQueueResponse {
  data: ProgramMatchQueueRow[];
  total: number;
  page: number;
  limit: number;
}

/** A PE→Program match row as decorated for the PE profile "Programs" panel. */
export interface PeProgramMatchRow {
  id: string;
  programId: string;
  program: { id: string; canonicalName: string; component: string | null; mdapCode: string | null; status: string } | null;
  peCode: string;
  projectCode: string | null;
  score: number;
  confidenceBand: ProgramConfidenceBand;
  evidenceTier: string;
  status: ProgramMatchStatus;
  whyShown: string;
  evidence: ProgramEvidenceItem[];
  resolvedAt: string | null;
}

export interface ProgramsForPeResponse {
  peCode: string;
  acceptedMatches: PeProgramMatchRow[];
  candidateMatches: PeProgramMatchRow[];
}

/** GET /api/programs?q= — alias trigram search (also used as an explorer search source). */
export async function getPrograms(
  api: AxiosInstance,
  q: string,
  limit?: number,
): Promise<ProgramSearchResponse> {
  return (await api.get<ProgramSearchResponse>('/api/programs', { params: { q, limit } })).data;
}

/** GET /api/programs/:id — full program profile (aliases, matches, awards, performers). */
export async function getProgram(api: AxiosInstance, id: string): Promise<Record<string, unknown>> {
  return (await api.get<Record<string, unknown>>(`/api/programs/${encodeURIComponent(id)}`)).data;
}

/** capiro_admin: GET /api/programs/admin/match-queue — candidate/quarantined PeProgramMatch rows. */
export async function getProgramMatchQueue(
  api: AxiosInstance,
  status: string,
  limit?: number,
): Promise<ProgramMatchQueueResponse> {
  return (
    await api.get<ProgramMatchQueueResponse>('/api/programs/admin/match-queue', {
      params: { status, limit },
    })
  ).data;
}

/** capiro_admin: POST /api/programs/admin/match-queue/:id/resolve — accept/reject/quarantine. */
export async function resolveProgramMatch(
  api: AxiosInstance,
  id: string,
  decision: ProgramMatchDecision,
  notes?: string,
): Promise<{ resolved: true; id: string; status: ProgramMatchStatus; decision: ProgramMatchDecision }> {
  return (
    await api.post<{ resolved: true; id: string; status: ProgramMatchStatus; decision: ProgramMatchDecision }>(
      `/api/programs/admin/match-queue/${encodeURIComponent(id)}/resolve`,
      { decision, notes },
    )
  ).data;
}

/** GET /api/program-elements/:peCode/programs — PE-keyed graph view for the PE profile panel. */
export async function getProgramsForPe(
  api: AxiosInstance,
  peCode: string,
): Promise<ProgramsForPeResponse> {
  return (
    await api.get<ProgramsForPeResponse>(
      `/api/program-elements/${encodeURIComponent(peCode)}/programs`,
    )
  ).data;
}
