// Outreach 2.0 — shared helpers for saved audiences (Lists + Groups).
//
// Lists and Groups are the two `kind`s of OutreachAudience (see the frozen
// data model). They persist through the SAME API
// (GET/POST /api/engagement/outreach/audiences) and share the same member
// shape, so the row types + the member↔recipient converters live here and are
// imported by both StepRecipientsSelect (Lists) and groups.tsx (Groups). One
// source of truth, no duplication.

import type { OutreachRecipient } from '../../OutreachView.js';

// ---- Saved-audience rows as returned by the API ----

export interface AudienceMemberRow {
  id: string;
  source: string;
  sourceRefId: string | null;
  name: string | null;
  email: string;
  title: string | null;
  office: string | null;
}

export interface AudienceRow {
  id: string;
  kind: 'list' | 'group';
  name: string;
  members: AudienceMemberRow[];
}

// In-progress list/group selection (build mode). Only one builder is active at
// a time; `kind` decides the send semantics + identity color.
export interface AudienceBuilderState {
  kind: 'list' | 'group';
  name: string;
  members: OutreachRecipient[];
}

// ---- Member ↔ recipient converters ----

/** A saved audience member → a wizard recipient, re-deriving its source key. */
export function audienceMemberToRecipient(member: AudienceMemberRow): OutreachRecipient {
  if (member.source === 'congress') {
    return {
      directoryContactId: member.sourceRefId ?? undefined,
      directoryContactName: member.name ?? undefined,
      name: member.name ?? undefined,
      email: member.email,
      title: member.title ?? undefined,
      office: member.office ?? undefined,
    };
  }
  if (member.source === 'client_contact' && member.sourceRefId) {
    return {
      id: `clientperson:${member.sourceRefId}`,
      name: member.name ?? undefined,
      email: member.email,
      title: member.title ?? undefined,
    };
  }
  return {
    id: `manual:${member.email.toLowerCase()}`,
    name: member.name ?? undefined,
    email: member.email,
    relevanceReason: 'Manually added',
  };
}

/** A wizard recipient → the member-input shape the audiences API validates. */
export function toAudienceMemberInput(r: OutreachRecipient) {
  const source: 'congress' | 'client_contact' | 'manual' = r.directoryContactId
    ? 'congress'
    : r.id?.startsWith('clientperson:')
      ? 'client_contact'
      : 'manual';
  return {
    source,
    sourceRefId:
      r.directoryContactId ??
      (source === 'client_contact' ? r.id?.slice('clientperson:'.length) : undefined),
    name: r.name,
    email: r.email ?? '',
    title: r.title,
    office: r.office,
  };
}

// ---- Small shared utilities ----

/** Pull a human-readable message out of an axios-style error, if present. */
export function apiErrorMessage(err: unknown): string | null {
  const resp = (err as { response?: { data?: { message?: unknown } } })?.response;
  const msg = resp?.data?.message;
  if (typeof msg === 'string') return msg;
  if (Array.isArray(msg) && typeof msg[0] === 'string') return msg[0];
  return null;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
