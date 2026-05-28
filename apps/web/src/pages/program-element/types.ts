export interface ProgramElementYearPoint {
  id: string;
  fy: number;
  request: string | number | null;
  conference: string | number | null;
  enacted: string | number | null;
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

export interface ProgramElementListResponse {
  data: ProgramElementListItem[];
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
}

export interface ProgramElementContractor {
  contractorName: string;
  amount: number;
  awards: number;
}

export interface ProgramElementContractorsResponse {
  data: ProgramElementContractor[];
  todo: string | null;
}
