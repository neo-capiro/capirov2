export interface FieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'currency' | 'textarea';
  required: boolean;
  section: string;
  description?: string;
  computed?: boolean;
}

export interface WorkflowTemplate {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  requiredSections: FieldDefinition[];
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
