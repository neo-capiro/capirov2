export interface ProgramElementYearPoint {
  id: string;
  fy: number;
  request: string | number | null;
  hascMark?: string | number | null;
  sascMark?: string | number | null;
  hacDMark?: string | number | null;
  sacDMark?: string | number | null;
  conference: string | number | null;
  enacted: string | number | null;
  notes?: string | null;
  raw?: unknown;
}

export interface ProgramElementDetail {
  peCode: string;
  title: string;
  service: string | null;
  budgetActivity: string | null;
  appropriationType: string | null;
  status: string | null;
  firstSeenFy: number | null;
  lastSyncedAt: string;
  currentUserIsWatching: boolean;
  years: ProgramElementYearPoint[];
}

export interface ProgramElementListItem {
  peCode: string;
  title: string;
  service: string | null;
  budgetActivity: string | null;
  appropriationType: string | null;
  status: string | null;
  lastSyncedAt: string;
}

export interface ProgramElementMarkupMonitorItem {
  peCode: string;
  title: string;
  service: string | null;
  request: number | null;
  hascMark: number | null;
  sascMark: number | null;
  hacDMark: number | null;
  sacDMark: number | null;
  divergencePct: number;
}

export interface ProgramElementListResponse {
  data: ProgramElementListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ProgramElementMarkupMonitorResponse {
  data: ProgramElementMarkupMonitorItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ProgramElementBill {
  id: string;
  congress: number;
  billType: string;
  billNumber: string;
  title: string;
  policyArea: string | null;
  latestActionText: string | null;
  latestActionDate: string | null;
  url: string | null;
  sponsor?: string | null;
  committee?: string | null;
  passageProbability?: number | null;
}

export interface ProgramElementContractor {
  contractorName: string;
  amount: number;
  awards: number;
  contractType?: string | null;
  contractorIsCrmClient?: boolean;
  isNewEntrant?: boolean;
}

export interface ProgramElementContractorsResponse {
  data: ProgramElementContractor[];
  todo: string | null;
}

export interface ProgramTeamPerson {
  id: string;
  fullName: string;
  service: string | null;
  organization: string | null;
  title: string | null;
  role: string | null;
  pePrimary: string | null;
  peSecondary: string[];
  emailDomain: string | null;
  publicProfileUrl: string | null;
  headshotUrl: string | null;
  confidence: number;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceCount: number;
}

export type ProgramElementSourceField =
  | 'request'
  | 'hascMark'
  | 'sascMark'
  | 'hacDMark'
  | 'sacDMark'
  | 'conference'
  | 'enacted';

export type ProgramElementYearSourceAttribution = Partial<
  Record<ProgramElementSourceField, string>
>;

export interface ProgramElementHistoryRow {
  id: string;
  fy: number;
  request: number | null;
  hascMark: number | null;
  sascMark: number | null;
  hacDMark: number | null;
  sacDMark: number | null;
  conference: number | null;
  enacted: number | null;
  projectedEnacted: boolean;
  sourceAttribution: ProgramElementYearSourceAttribution;
}

export interface FyHistoryChartProps {
  rows: ProgramElementHistoryRow[];
  loading?: boolean;
  onFyClick?: (fy: number) => void;
}

// ── Person -> PE link candidate review queue (Phase 1b) ───────────────────────
export interface PersonCandidate {
  id: string;
  personId: string;
  peCode: string;
  score: number;
  matchBasis: string;
  status: string;
  person: {
    id: string;
    fullName: string;
    organization: string | null;
    title: string | null;
    role: string | null;
  } | null;
  programElement: {
    peCode: string;
    title: string | null;
    service: string | null;
  } | null;
}

export interface PersonCandidateListResponse {
  data: PersonCandidate[];
  total: number;
  page: number;
  limit: number;
}

// ── DoW Directory (AcquisitionPersonnel list/detail) ──────────────────────────
// Backed by GET /api/acquisition-personnel (+ /:id). Reuses ProgramTeamPerson as
// the list-item shape (identical fields).
export type AcquisitionPersonnelListItem = ProgramTeamPerson;

export interface AcquisitionPersonnelListResponse {
  data: AcquisitionPersonnelListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AcquisitionPersonnelSourceMention {
  id: string;
  source: string;
  sourceUrl: string | null;
  snippet: string | null;
  observedAt: string;
  confidence: number;
  metadata: unknown;
}

export interface AcquisitionPersonnelDetail {
  id: string;
  fullName: string;
  nameKey: string;
  service: string | null;
  organization: string | null;
  title: string | null;
  role: string | null;
  programOfRecord: string | null;
  pePrimary: string | null;
  peSecondary: string[];
  emailDomain: string | null;
  publicProfileUrl: string | null;
  confidence: number;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  metadata: unknown;
  sources: AcquisitionPersonnelSourceMention[];
}

export interface AcquisitionPersonnelListParams {
  service?: string;
  organization?: string;
  role?: string;
  pe_code?: string;
  pe_aligned?: 'aligned' | 'unaligned';
  sort?: 'pe_first' | 'confidence';
  q?: string;
  page?: number;
  limit?: number;
}

// ── CRM contact picker (link an acquisition-personnel record to a contact) ────
export interface EngagementContactListItem {
  id: string;
  fullName: string | null;
  email: string | null;
  organization: string | null;
  title: string | null;
  clientId: string | null;
}
