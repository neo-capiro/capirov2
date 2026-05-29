// Outreach v2 wizard, shared types.
//
// These mirror the data model in the design mockup. The context-item shape
// is the centerpiece of the v2 flow: every selected item carries a `scope`
// (either 'all' for shared, or a recipient id for per-recipient targeting)
// and an optional `note` that the user can write to bias the AI generation
// for that one item.

import type { OutreachRecipient } from '../../OutreachView.js';

export type WizardDirection = 'on-behalf' | 'to-clients';

export type ContextKind = 'bill' | 'intel' | 'email' | 'meeting' | 'note';

export interface ContextPoolItem {
  id: string;
  kind: ContextKind;
  title: string;
  body?: string;
  sub?: string;
  tag?: string;
  // Recipient ids or client ids this item naturally maps to. The wizard uses
  // this for smart routing: when the user selects an item, we auto-set scope
  // to the matching recipient if there's exactly one match, else 'all'.
  matches?: string[];
}

export interface SelectedContextItem extends ContextPoolItem {
  // 'all' = shared across every recipient. Otherwise a recipient.id.
  scope: 'all' | string;
  // Free-form instruction the user writes to the AI for this item only.
  note: string;
}

export interface WizardV2State {
  direction: WizardDirection | null;
  clientId: string | null;
  campaignName: string;
  recipients: OutreachRecipient[];
  contextItems: SelectedContextItem[];
  templateId: string | null;
  tone: 'Professional' | 'Friendly' | 'Formal' | 'Concise';
  generatedEmails: Record<string, { subject: string; body: string; status: 'pending' | 'ready' | 'edited' | 'error' }>;
  selectedRecipientIdx: number;
}

export const INITIAL_V2_STATE: WizardV2State = {
  direction: null,
  clientId: null,
  campaignName: '',
  recipients: [],
  contextItems: [],
  templateId: null,
  tone: 'Professional',
  generatedEmails: {},
  selectedRecipientIdx: 0,
};

export const WIZARD_STEPS = [
  { id: 'direction', label: 'Direction' },
  { id: 'setup', label: 'Campaign Setup' },
  { id: 'recipients', label: 'Recipients' },
  { id: 'context', label: 'Build Context' },
  { id: 'template', label: 'Template' },
  { id: 'generate', label: 'Generate & Review' },
  { id: 'send', label: 'Send' },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]['id'];

/** Stable id for a recipient, same logic used by the older wizard. */
export function recipientKey(r: OutreachRecipient): string {
  return r.id || r.directoryContactId || r.email || r.name || JSON.stringify(r);
}
