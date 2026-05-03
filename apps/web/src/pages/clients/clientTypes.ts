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
  intakeData: ClientIntakeData | null;
  status: string;
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
}

export interface ClientFormValues {
  name?: string;
  website?: string;
  description?: string;
  productDescription?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
  sector?: string;
  trl?: string;
  fundingAsk?: string;
  requestType?: string;
  peNumber?: string;
  engagement?: string;
  portfolioText?: string;
  documentsText?: string;
  priorContracts?: string;
  grants?: string;
  priorEngagement?: string;
}
