// Shape mirrors the NestJS Clio service responses. Kept here (not in
// @capiro/shared) until the contract stabilizes — the API is brand new and
// we'll iterate on it across the next few phases.

export type ClioSessionStatus = 'active' | 'archived' | 'deleted';
export type ClioMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface SessionSummary {
  id: string;
  title: string;
  model: string;
  status: ClioSessionStatus;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClioMessage {
  id: string;
  role: ClioMessageRole;
  content: string | null;
  createdAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: string | null;
}

export interface SessionWithMessages extends SessionSummary {
  messages: ClioMessage[];
}

export type ClioArtifactKind =
  | 'policy_memo'
  | 'meeting_brief'
  | 'client_intel_update'
  | 'regulatory_comment'
  | 'appropriations_request'
  | 'other';

export interface ArtifactSummary {
  id: string;
  kind: ClioArtifactKind;
  title: string;
  version: number;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface ArtifactFull extends ArtifactSummary {
  content: string | null;
  s3Key: string | null;
  s3ContentType: string | null;
}

export interface ArtifactList {
  items: ArtifactSummary[];
}
