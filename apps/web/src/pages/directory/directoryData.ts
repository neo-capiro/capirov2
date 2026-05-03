export type Chamber = 'House' | 'Senate' | 'Governor';
export type Party = 'D' | 'R' | 'I';
export type RelationshipTier = 'Core' | 'Active' | 'Watch';

export interface DirectoryInteraction {
  date: string;
  channel: 'Call' | 'Email' | 'Meeting' | 'Dinner' | 'Briefing';
  summary: string;
}

export interface DirectoryAddress {
  id: string;
  title: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  fax: string;
  isMain: boolean;
}

export interface DirectoryLink {
  label: string;
  url: string;
  type: string;
}

export interface DirectoryStaffMember {
  id: string;
  fullName: string;
  title: string;
  roles: string[];
  issueAreas: string[];
  email: string;
  phone: string;
  officeLocation: string;
}

export interface DirectoryEntry {
  id: string;
  memberId: number;
  bioguideId: string;
  fullName: string;
  memberName: string;
  honorific: string;
  photoUrl: string;
  title: string;
  office: string;
  chamber: Chamber;
  state: string;
  district: string;
  party: Party;
  partyName: string;
  gender: 'F' | 'M' | 'Unknown';
  region: 'Northeast' | 'South' | 'Midwest' | 'West';
  isFreshman: boolean;
  servingSince: string;
  focusAreas: string[];
  committees: string[];
  leadershipPositions: string[];
  caucuses: string[];
  educationInstitutions: string[];
  officeLocation: string;
  phone: string;
  fax: string;
  email: string;
  contactFormUrl: string;
  officialLinks: DirectoryLink[];
  addresses: DirectoryAddress[];
  staff: DirectoryStaffMember[];
  bio: {
    dob: string;
    hometown: string;
    birthplace: string;
    occupation: string;
    race: string;
    religion: string;
    pronunciation: string;
  };
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
  availableFilters: {
    chambers: Chamber[];
    parties: Array<{ value: Party; label: string }>;
    genders: Array<{ value: 'F' | 'M'; label: string }>;
    leadership: string[];
    caucuses: string[];
    states: string[];
    districts: string[];
    educationInstitutions: string[];
  };
}
