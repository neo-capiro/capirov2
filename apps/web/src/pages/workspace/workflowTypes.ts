export type RequestType = 'funding' | 'policy';
export type FieldType = 'text' | 'integer' | 'textarea' | 'select' | 'boolean';
export type TemplateCategory = 'authorization' | 'appropriations' | 'language' | 'supporting';

export interface ConditionalDef {
  field: string;
  value: boolean | string | number;
}

export interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  maxLength?: number;
  options?: string[];
  helpText?: string;
  conditional?: ConditionalDef;
  source?: string;
}

export interface SectionDefinition {
  title: string;
  helpText?: string;
  fields: FieldDefinition[];
}

export interface RequestSections {
  requestTypes: string[];
  sections: {
    funding?: { section1: SectionDefinition };
    policy?: { section1: SectionDefinition };
    shared: {
      requesterContact: SectionDefinition;
      orgContact: SectionDefinition;
    };
  };
}

export interface WorkflowTemplate {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: TemplateCategory;
  requiredSections: RequestSections;
  contextInfo: Record<string, unknown>;
  isActive: boolean;
  sortOrder: number;
}

export type WorkflowStatus = 'triage' | 'in_progress' | 'review' | 'submitted' | 'complete';
export type SubmissionMethod = 'portal' | 'email' | 'in-person';

export interface WorkflowInstance {
  id: string;
  title: string;
  status: WorkflowStatus;
  templateSlug: string;
  clientId: string | null;
  formData: Record<string, unknown>;
  targetMember: string | null;
  submissionDeadline: string | null;
  submissionMethod: SubmissionMethod | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  template: WorkflowTemplate | null;
  client: { id: string; name: string } | null;
}

export interface Strategy {
  id: string;
  tenantId: string;
  clientId: string;
  capabilityId: string | null;
  name: string;
  fiscalYear: string | null;
  status: string;
  description: string | null;
  submissionTypes: string[];
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; name: string };
  capability?: { id: string; name: string; fundingAsk: number | null };
  targets?: StrategyTarget[];
  instances?: (WorkflowInstance & { template: WorkflowTemplate })[];
}

export interface StrategyTarget {
  id: string;
  strategyId: string;
  memberName: string;
  memberTitle: string | null;
  memberParty: string | null;
  memberState: string | null;
  committee: string | null;
  subcommittee: string | null;
  stafferName: string | null;
  stafferEmail: string | null;
  directoryContactId: string | null;
  outreachStatus: string;
  meetingDate: string | null;
  notes: string | null;
}

export const STATUS_LABELS: Record<WorkflowStatus, string> = {
  triage: 'Triage',
  in_progress: 'In Progress',
  review: 'Under Review',
  submitted: 'Submitted',
  complete: 'Complete',
};

export const STATUS_TAG_COLORS: Record<WorkflowStatus, string> = {
  triage: 'default',
  in_progress: 'processing',
  review: 'warning',
  submitted: 'cyan',
  complete: 'success',
};

export const KANBAN_COLUMNS: { status: WorkflowStatus; label: string }[] = [
  { status: 'triage', label: 'Triage' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'review', label: 'Under Review' },
  { status: 'submitted', label: 'Submitted' },
  { status: 'complete', label: 'Complete' },
];
