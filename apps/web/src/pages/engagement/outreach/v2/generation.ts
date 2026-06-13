// Outreach 2.0 — generation target model for Generate & Review (board step 10).
//
// Drafts in WizardV2State.generatedEmails are keyed by a GenerationTargetKey
// (per the frozen data-model doc §4), NOT by a flat recipientKey:
//   individual:<recipientKey>          one personalized draft
//   list:<audienceId>:<recipientKey>   one draft PER MEMBER of a list
//   group:<audienceId>                 ONE shared draft for the whole group
//
// (The doc also models a list-wide `list:<aid>` draft; the board personalizes
// every list member instead, so we materialize per-member drafts and let the
// edit-propagation banner copy one member's edit across the list. `appliesTo`
// is derived from the key prefix, so the stored draft value is unchanged.)
//
// Generation still flows through the unchanged POST /outreach/generate-batch
// (flat recipients[] → results keyed by recipientId). This module maps the
// entity model onto that flat contract: individuals/list-members send
// themselves; a group sends a single representative whose result becomes the
// one shared group draft. At send, projectDraftsForSend() fans the per-target
// drafts back to one flat {recipientId,subject,body} per recipient.

import type { OutreachRecipient } from '../../OutreachView.js';
import { recipientKey } from './types.js';
import type { OutreachTarget, TargetType } from './targets.js';

export type GenerationAppliesTo = 'individual' | 'member' | 'group';

/**
 * A stable audience id for a list/group target. Saved audiences carry an
 * `audienceId`; campaign-local ones fall back to the (uuid) target key so the
 * generation keys are always well-formed and stable within a session. Both are
 * colon-free, which keeps `list:<aid>:<recipientKey>` parseable even though a
 * recipientKey may itself contain colons.
 */
export function audienceIdOf(t: OutreachTarget): string {
  return t.audienceId ?? t.key;
}

/** One editable draft "slot" — the unit the rail shows and generation fills. */
export interface GenSlot {
  genKey: string;
  appliesTo: GenerationAppliesTo;
  /**
   * Recipient(s) POSTed to generate-batch to produce this draft. Individuals
   * and list members send themselves; a group sends one representative.
   */
  genRecipients: OutreachRecipient[];
  /** The recipientId the backend result carries for genRecipients[0]. */
  resultId: string;
  /** Extra prompt context — a group passes its full member listing. */
  additionalContext?: string;
}

/** A selectable row in the left rail (an individual, a list member, or a group). */
export interface RailSlot {
  genKey: string;
  appliesTo: GenerationAppliesTo;
  name: string;
  sub: string;
  recipient: OutreachRecipient;
}

/** A rail card grouping its slots (individual: 1, list: N members, group: 1). */
export interface RailEntity {
  kind: TargetType;
  target: OutreachTarget;
  name: string;
  audienceId?: string;
  members: RailSlot[];
}

export interface SendDraft {
  recipientId: string;
  subject: string;
  body: string;
}

function contextLine(r: OutreachRecipient): string {
  return r.office || r.state || r.title || '';
}

function groupAdditionalContext(name: string, members: OutreachRecipient[]): string {
  const lines = members.map((m) => {
    const where = contextLine(m);
    return `- ${m.name || m.email || 'Recipient'}${where ? ` (${where})` : ''}`;
  });
  return `This is ONE shared email addressed together to the group "${name}". Write a single message appropriate for all of these recipients:\n${lines.join('\n')}`;
}

/** Build the rail entities + the flat slot list (the unit of generation). */
export function buildGenerationModel(targets: OutreachTarget[]): {
  entities: RailEntity[];
  slots: GenSlot[];
} {
  const entities: RailEntity[] = [];
  const slots: GenSlot[] = [];

  for (const t of targets) {
    if (t.type === 'individual') {
      const r = t.recipients[0];
      if (!r) continue;
      const genKey = `individual:${recipientKey(r)}`;
      slots.push({
        genKey,
        appliesTo: 'individual',
        genRecipients: [r],
        resultId: recipientKey(r),
      });
      entities.push({
        kind: 'individual',
        target: t,
        name: r.name || r.email || 'Recipient',
        members: [
          {
            genKey,
            appliesTo: 'individual',
            name: r.name || r.email || 'Recipient',
            sub: contextLine(r),
            recipient: r,
          },
        ],
      });
    } else if (t.type === 'list') {
      const aid = audienceIdOf(t);
      const members: RailSlot[] = [];
      for (const m of t.recipients) {
        const genKey = `list:${aid}:${recipientKey(m)}`;
        slots.push({ genKey, appliesTo: 'member', genRecipients: [m], resultId: recipientKey(m) });
        members.push({
          genKey,
          appliesTo: 'member',
          name: m.name || m.email || 'Recipient',
          sub: contextLine(m),
          recipient: m,
        });
      }
      if (members.length === 0) continue;
      entities.push({
        kind: 'list',
        target: t,
        name: t.name || 'Untitled list',
        audienceId: aid,
        members,
      });
    } else {
      // group — ONE shared draft for the whole set.
      const aid = audienceIdOf(t);
      const rep = t.recipients[0];
      if (!rep) continue;
      const genKey = `group:${aid}`;
      slots.push({
        genKey,
        appliesTo: 'group',
        genRecipients: [rep],
        resultId: recipientKey(rep),
        additionalContext: groupAdditionalContext(t.name || 'Group', t.recipients),
      });
      const count = t.recipients.length;
      entities.push({
        kind: 'group',
        target: t,
        name: t.name || 'Untitled group',
        audienceId: aid,
        members: [
          {
            genKey,
            appliesTo: 'group',
            name: t.name || 'Untitled group',
            sub: `${count} ${count === 1 ? 'contact' : 'contacts'} · 1 email`,
            recipient: rep,
          },
        ],
      });
    }
  }

  return { entities, slots };
}

/** Extract the audience id from a `list:<aid>:<recipientKey>` member key. */
export function listAidFromKey(genKey: string): string | null {
  if (!genKey.startsWith('list:')) return null;
  const rest = genKey.slice('list:'.length);
  const idx = rest.indexOf(':'); // aid is colon-free, so this is the aid boundary
  return idx === -1 ? null : rest.slice(0, idx);
}

/**
 * Project per-target drafts back to one flat {recipientId,subject,body} per
 * recipient for the unchanged send-batch contract. A group's single shared
 * draft is fanned to every member (the send pipeline still posts one email per
 * recipient — true "one email to all on To" awaits the Send rebuild). Drafts
 * with no subject AND no body are skipped.
 */
export function projectDraftsForSend(
  targets: OutreachTarget[],
  generated: Record<string, { subject: string; body: string; status: string }>,
): SendDraft[] {
  const out: SendDraft[] = [];
  const seen = new Set<string>();
  const push = (r: OutreachRecipient, draft?: { subject: string; body: string }) => {
    if (!draft) return;
    if (!draft.subject?.trim() && !draft.body?.trim()) return;
    const id = recipientKey(r);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ recipientId: id, subject: draft.subject, body: draft.body });
  };

  const handle = (t: OutreachTarget) => {
    if (t.type === 'individual') {
      const r = t.recipients[0];
      if (r) push(r, generated[`individual:${recipientKey(r)}`]);
    } else if (t.type === 'list') {
      const aid = audienceIdOf(t);
      for (const m of t.recipients) push(m, generated[`list:${aid}:${recipientKey(m)}`]);
    } else {
      const aid = audienceIdOf(t);
      const shared = generated[`group:${aid}`];
      for (const m of t.recipients) push(m, shared);
    }
  };

  // Process groups FIRST so a group always emits its shared draft for its
  // members. (The recipients step already prevents a person from being in two
  // targets; this ordering keeps the projection correct even if that ever
  // changes — a group member is never pre-empted by an individual/list draft.)
  for (const t of targets) if (t.type === 'group') handle(t);
  for (const t of targets) if (t.type === 'list') handle(t);
  for (const t of targets) if (t.type === 'individual') handle(t);
  return out;
}
