// Workspace engine types — mirror the @capiro/workspace API responses and the
// ws-config-v4 state model (from the prototype). The web app talks to the
// engine at /workspace-api/* via the shared axios client (useApi).

export interface WsAsk {
  amount?: string;
  pb?: string;
  delta?: string;
}

export interface WsLetterhead {
  custom: boolean;
  firmName: string;
  firmAddr: string;
}

/** The persisted engine config blob (ws-config-v4). */
export interface WsConfig {
  industry: string | null;
  product: string | null;
  client: string | null;
  pathways: string[];
  committees: string[];
  personalize: boolean;
  officeAssociated: boolean;
  offices: string[];
  coverLetter: boolean;
  selectedTemplate: string | null;
  sections: string[];
  pages: number;
  tone: string;
  toneContext?: string;
  linkedData: string[];
  anonymize: boolean;
  letterhead: WsLetterhead;
  [key: string]: unknown;
}

export type WsDocStatus = 'draft' | 'complete';
export type WsRole = 'editor' | 'reviewer' | 'viewer' | 'commenter';

export interface WsDocument {
  id: string;
  draftId: string;
  name: string;
  ordinal: number;
  body: { blocks?: WsBlock[] } & Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WsDraft {
  id: string;
  tenantId: string;
  ownerId: string;
  docTitle: string;
  industry: string | null;
  product: string | null;
  client: string | null;
  status: WsDocStatus;
  isPacket: boolean;
  docCount: number;
  ask: WsAsk | 'n/a' | null;
  config: WsConfig;
  createdAt: string;
  updatedAt: string;
  documents: WsDocument[];
}

export interface WsTemplate {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  product: string;
  style: string | null;
  fontFamily: string | null;
  accentColor: string | null;
  meriPrimary: boolean;
  meriSecondary: boolean;
  elements: string[];
  sections: string[];
}

export interface WsComment {
  id: string;
  documentId: string;
  authorId: string;
  role: WsRole;
  quote: string | null;
  anchor: Record<string, unknown> | null;
  body: string;
  resolved: boolean;
  parentId: string | null;
  createdAt: string;
  replies?: WsComment[];
}

export interface WsProductDefaults {
  product: string;
  personalize: boolean;
  officeAssociated: boolean;
  coverLetter: boolean;
  sections: string[];
  pages: number;
  funding: boolean;
  icon: string;
  description: string;
}

/** A rich block in the document body (section, photo, table, logo). */
export interface WsBlock {
  id: string;
  type: 'section' | 'photo' | 'table' | 'logo';
  title?: string;
  content?: string;
  [key: string]: unknown;
}

export interface WsContextItem {
  id: string;
  draftId: string;
  kind: 'source' | 'news' | 'free-text';
  payload: Record<string, unknown>;
  createdAt: string;
}
