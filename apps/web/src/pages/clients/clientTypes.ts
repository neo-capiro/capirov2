export interface SubmissionHistoryEntry {
  fy: string;
  title: string;
  meta: string;
  outcome: string;
  outcomeType: 'success' | 'partial' | 'failed' | 'in_progress';
  notes?: string;
}

export interface Capability {
  id: string;
  name: string;
  type: 'product' | 'service' | 'platform' | 'technology';
  description?: string;
  sector?: string;
  tags?: string[];
  trl?: number;
  mrl?: number;
  peNumber?: string;
  appropriationAccount?: string;
  service?: string;
  targetSubcommittee?: string;
  fundingAsk?: number;
  fundingAskLabel?: string;
  justification?: string;
  districtNexus?: string;
  existingContracts?: string;
  submissionHistory?: SubmissionHistoryEntry[];
  notes?: string;
}

export interface ClientPerson {
  id: string;
  name: string;
  title: string;
  email?: string;
  phone?: string;
  role?: string;
  lastContact?: string;
}

export interface ClientIntakeData extends Record<string, unknown> {
  sector?: string;
  trl?: string | number;
  fundingAsk?: string;
  requestType?: string;
  peNumber?: string;
  engagement?: string;
  portfolio?: string[];
  tags?: string[];
  documents?: ClientDocument[];
  governmentHistory?: Record<string, unknown>;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  pocName?: string;
  pocTitle?: string;
  pocPhone?: string;
  pocEmail?: string;
  headName?: string;
  headTitle?: string;
  cageCode?: string;
  uei?: string;
  primaryNaics?: string;
  samStatus?: string;
  existingContracts?: string;
  capabilities?: Capability[];
  people?: ClientPerson[];
}

export interface ClientDocument {
  name: string;
  type?: string;
  date?: string;
}

export interface Client {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  productDescription: string | null;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  logoS3Key: string | null;
  logoContentType: string | null;
  logoUploadedAt: string | null;
  logoUrl?: string | null;
  intakeData: ClientIntakeData | null;
  status: string;
  // Portfolio v2 additions — controlled vocab (see @capiro/shared).
  sectorTag?: string | null;
  profileType?: string | null;
  profileStatus?: string | null;
  submissionTracks?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ClientPayload {
  name: string;
  website?: string;
  description?: string;
  productDescription?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  intakeData?: Record<string, unknown>;
  sectorTag?: string | null;
  profileType?: string | null;
  profileStatus?: string | null;
  submissionTracks?: string[];
}

export interface ClientAttachment {
  id: string;
  clientId: string | null;
  meetingId: string | null;
  mailMessageId: string | null;
  fileName: string;
  contentType: string;
  byteSize: number | null;
  source: string;
  createdAt: string;
  downloadUrl: string | null;
}

export interface ClientFormValues {
  name?: string;
  website?: string;
  description?: string;
  productDescription?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  /** Controlled SectorTag — see SECTOR_TAGS in @capiro/shared. */
  sectorTag?: string;
  /** Controlled SubmissionTrack[] — see SUBMISSION_TRACKS in @capiro/shared. */
  submissionTracks?: string[];
  trl?: string;
  fundingAsk?: string;
  requestType?: string;
  peNumber?: string;
  engagement?: string;
  portfolioText?: string;
  priorContracts?: string;
  grants?: string;
  priorEngagement?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  pocName?: string;
  pocTitle?: string;
  pocPhone?: string;
  pocEmail?: string;
  headName?: string;
  headTitle?: string;
}

export interface ClientFormSubmit {
  payload: ClientPayload;
  documents: File[];
  logo?: File;
}
