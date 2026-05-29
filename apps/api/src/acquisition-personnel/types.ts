export interface PersonRecordInput {
  fullName: string;
  service?: string | null;
  organization?: string | null;
  title?: string | null;
  role?: string | null;
  programOfRecord?: string | null;
  pePrimary?: string | null;
  peSecondary?: string[] | null;
  email?: string | null;
  emailDomain?: string | null;
  publicProfileUrl?: string | null;
  metadata?: unknown;
  programs?: string[] | null;
  peCodesMentioned?: string[] | null;
}

export interface MatchBreakdown {
  nameSimilarity: number;
  orgSimilarity: number;
  titleCompatibility: number;
  emailDomainMatch: number;
  programOverlap: number;
}

export interface MatchResult {
  personId: string;
  score: number;
  breakdown: MatchBreakdown;
  reason: string;
}
