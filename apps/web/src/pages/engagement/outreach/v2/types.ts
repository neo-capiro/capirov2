// Outreach v2 wizard, shared types.
//
// These mirror the data model in the design mockup. The context-item shape
// is the centerpiece of the v2 flow: every selected item carries a `scope`
// (either 'all' for shared, or a recipient id for per-recipient targeting)
// and an optional `note` that the user can write to bias the AI generation
// for that one item.

import type { OutreachRecipient } from '../../OutreachView.js';
import type { OutreachTarget } from './targets.js';

export type WizardDirection = 'on-behalf' | 'to-clients';

export type ContextKind =
  | 'bill'
  | 'intel'
  | 'email'
  | 'meeting'
  | 'note'
  | 'document'
  | 'debrief'
  | 'prep';

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
  // Owning client (for the Docs/Notes, Debriefs, Preps tabs, which group their
  // pool by client). `clientId` null = unassigned; `clientName` is the resolved
  // display label. `date` (ISO) drives most-recent-first ordering.
  clientId?: string | null;
  clientName?: string;
  date?: string;
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
  /**
   * Outreach 2.0 recipient model: mixed Individual/List/Group targets with
   * per-type cc/bcc (see targets.ts). Source of truth for who gets emailed.
   */
  targets: OutreachTarget[];
  /**
   * Legacy flat projection of `targets` (flattenTargets) consumed by the
   * not-yet-rebuilt downstream steps (context/generate/send). Derived —
   * never edit directly once targets exist.
   */
  recipients: OutreachRecipient[];
  contextItems: SelectedContextItem[];
  templateId: string | null;
  tone: 'Professional' | 'Friendly' | 'Formal' | 'Concise';
  /**
   * Per-target generated drafts, keyed by GenerationTargetKey (see
   * generation.ts): `individual:<rk>` | `list:<aid>:<rk>` | `group:<aid>`.
   * Individuals + list members get one draft each; a group gets one shared
   * draft. (`appliesTo` is derived from the key prefix, so the value shape is
   * unchanged.)
   */
  generatedEmails: Record<
    string,
    { subject: string; body: string; status: 'pending' | 'ready' | 'edited' | 'error' }
  >;
  /** Generate & Review: the GenerationTargetKey of the draft being edited. */
  selectedGenerationKey: string | null;
  /** EngagementAttachment ids to attach to the generated emails on send. */
  attachmentIds: string[];
  /**
   * Signature of the generation inputs (context items + template + tone +
   * direction) captured at the last FULL generation. When the live inputs no
   * longer match this, Generate & Review shows a "context changed — regenerate"
   * banner. null = nothing generated yet (no banner).
   */
  generatedInputSig: string | null;
}

export const INITIAL_V2_STATE: WizardV2State = {
  direction: null,
  clientId: null,
  campaignName: '',
  targets: [],
  recipients: [],
  contextItems: [],
  templateId: null,
  tone: 'Professional',
  generatedEmails: {},
  selectedGenerationKey: null,
  attachmentIds: [],
  generatedInputSig: null,
};

export const WIZARD_STEPS = [
  { id: 'direction', label: 'Direction' },
  // Campaign Setup names the campaign AND chooses the template — the
  // standalone Template step was folded into this one.
  { id: 'setup', label: 'Campaign Setup' },
  { id: 'recipients', label: 'Recipients' },
  { id: 'context', label: 'Build Context' },
  { id: 'generate', label: 'Generate & Review' },
  { id: 'send', label: 'Send' },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]['id'];

/** Stable id for a recipient, same logic used by the older wizard. */
export function recipientKey(r: OutreachRecipient): string {
  return r.id || r.directoryContactId || r.email || r.name || JSON.stringify(r);
}
