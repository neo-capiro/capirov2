export type Chamber = 'House' | 'Senate' | 'Governor';
export type Party = 'D' | 'R' | 'I';
export type RelationshipTier = 'Core' | 'Active' | 'Watch';

export interface DirectoryInteraction {
  date: string;
  channel: 'Call' | 'Email' | 'Meeting' | 'Dinner' | 'Briefing';
  summary: string;
}

export interface DirectoryEntry {
  id: string;
  fullName: string;
  photoUrl: string;
  title: string;
  office: string;
  memberName: string;
  chamber: Chamber;
  state: string;
  party: Party;
  region: 'Northeast' | 'South' | 'Midwest' | 'West';
  focusAreas: string[];
  committees: string[];
  officeLocation: string;
  phone: string;
  email: string;
  lastTouchpoint: string;
  owner: string;
  relationshipTier: RelationshipTier;
  notes: string;
  recentInteractions: DirectoryInteraction[];
}

export interface DirectoryApiResponse {
  sourceId: string;
  contacts: DirectoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  totals: {
    all: number;
    house: number;
    senate: number;
    governors: number;
  };
  availableStates: string[];
}
