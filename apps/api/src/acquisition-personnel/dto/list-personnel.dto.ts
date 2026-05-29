export class ListPersonnelDto {
  service?: string;
  organization?: string;
  role?: string;
  pe_code?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export interface PersonnelListItemDto {
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
  confidence: number;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceCount: number;
}

export interface PersonnelListResponseDto {
  data: PersonnelListItemDto[];
  total: number;
  page: number;
  limit: number;
}
