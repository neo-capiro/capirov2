// Outreach 2.0 target model — frontend wizard state per the frozen design
// doc (§5 "Frontend wizard state"). A target is one of the three recipient
// types; a campaign mixes any combination:
//   individual → 1 recipient, 1 email
//   list       → N recipients, each gets their OWN 1:1 email
//   group      → N recipients on ONE shared email
//
// cc/bcc semantics (doc "Send semantics" table):
//   individual → copies on that one email
//   list       → copies on EACH member's 1:1 email (+ optional per-member
//                extras via memberCc/memberBcc, which persist per recipient
//                row as cc_jsonb when the backend model lands)
//   group      → copies on the single shared email
//
// Until the OutreachAudience tables/API exist (migration pending sign-off),
// list/group audiences are campaign-local: created in the wizard, stored on
// the campaign draft via metadata.targets, identified by `local-…` ids.
//
// flattenTargets() projects targets onto the legacy flat OutreachRecipient[]
// so the downstream steps (context, generate, send) keep working unchanged.
// NOTE: the legacy pipeline sends one email PER recipient, so a group's
// "one shared email" semantics are not enforced until Generate/Send are
// rebuilt — each group member still receives an individual email for now.

import type { OutreachRecipient } from '../../OutreachView.js';
import { recipientKey } from './types.js';

export type TargetType = 'individual' | 'list' | 'group';

/**
 * A Cc/Bcc copy added as a named contact (vs. a bare email string). Individual
 * targets carry these via the Cc/Bcc popover so the row can render "Cc · Jane
 * Doe" pills; only `.email` reaches the actual send (see flattenTargets).
 */
export interface CcBccContact {
  /** Stable identity for dedupe: directory id, `clientperson:<id>`, or `manual:<email>`. */
  id: string;
  name: string;
  email: string;
  source: 'congress' | 'client' | 'manual';
}

export interface OutreachTarget {
  /** Stable target id (uuid). */
  key: string;
  type: TargetType;
  /** Audience id for list/group; `local-…` until saved audiences exist. */
  audienceId?: string;
  /** Display name for list/group targets. */
  name?: string;
  /** 1 entry for individual; N for list/group. */
  recipients: OutreachRecipient[];
  /** Emails copied per the send-semantics table above. */
  cc: string[];
  bcc: string[];
  /**
   * Contact-based Cc/Bcc (name + email) chosen in the Cc/Bcc popover:
   *   • individual target → copies on that person's email
   *   • list target → "Cc/Bcc Entire List": copies on EVERY member's email
   * Their emails are merged into the flat cc/bcc on send (flattenTargets).
   * (group keeps using the cc/bcc email arrays above.)
   */
  ccContacts?: CcBccContact[];
  bccContacts?: CcBccContact[];
  /** List targets only: extra copies for one member, keyed by recipientKey. */
  memberCc?: Record<string, string[]>;
  memberBcc?: Record<string, string[]>;
  /**
   * List targets only: per-member contact-based Cc/Bcc chosen via a member
   * row's Add Cc/Bcc popover, keyed by recipientKey. Copies on that one
   * member's email only (on top of the entire-list ccContacts above).
   */
  memberCcContacts?: Record<string, CcBccContact[]>;
  memberBccContacts?: Record<string, CcBccContact[]>;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function newTargetKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function dedupeEmails(values: string[]): string[] {
  return Array.from(
    new Set(values.map((v) => v.trim().toLowerCase()).filter((v) => EMAIL_RE.test(v))),
  );
}

export function individualTarget(recipient: OutreachRecipient): OutreachTarget {
  // Lift any cc/bcc already baked onto the recipient (legacy drafts) up to
  // the target so flattenTargets() stays the single place that resolves them.
  const { cc, bcc, ...rest } = recipient;
  return {
    key: newTargetKey(),
    type: 'individual',
    recipients: [rest],
    cc: cc ?? [],
    bcc: bcc ?? [],
  };
}

/**
 * First target containing this person. `scope: 'personal'` checks only the
 * individual + list targets (the recipient's own "To" email); group membership
 * is ORTHOGONAL — a person may be in a group AND be an individual / list member
 * (they get their personal email AND ride the group's shared To), so groups
 * neither block nor are blocked by the personal slot. `scope: 'all'` (default)
 * scans every target type.
 */
export function membershipOf(
  targets: OutreachTarget[],
  key: string,
  scope: 'all' | 'personal' = 'all',
): TargetType | null {
  const types =
    scope === 'personal'
      ? (['individual', 'list'] as const)
      : (['individual', 'list', 'group'] as const);
  for (const type of types) {
    for (const t of targets) {
      if (t.type !== type) continue;
      if (t.recipients.some((r) => recipientKey(r) === key)) return type;
    }
  }
  return null;
}

/**
 * Total UNIQUE people across all targets — matches what flattenTargets emits
 * (and therefore what generate/send actually queue), so the header badge can
 * never disagree with the downstream steps.
 */
export function totalRecipients(targets: OutreachTarget[]): number {
  const seen = new Set<string>();
  for (const t of targets) for (const r of t.recipients) seen.add(recipientKey(r));
  return seen.size;
}

/**
 * Defensive normalizer for targets read back from draft metadata. Drafts are
 * exactly where old shapes linger (metadata.targets is interim storage until
 * the OutreachAudience tables land), and flattenTargets spreads cc/bcc and
 * iterates recipients unguarded — a malformed entry must be dropped or
 * coerced here rather than crash the wizard on resume.
 */
export function sanitizeTargets(raw: unknown): OutreachTarget[] {
  if (!Array.isArray(raw)) return [];
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  const memberMap = (v: unknown): Record<string, string[]> | undefined => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const map: Record<string, string[]> = {};
    for (const [k, vals] of Object.entries(v as Record<string, unknown>)) map[k] = strings(vals);
    return map;
  };
  const contacts = (v: unknown): CcBccContact[] | undefined => {
    if (!Array.isArray(v)) return undefined;
    const out: CcBccContact[] = [];
    for (const c of v) {
      if (!c || typeof c !== 'object') continue;
      const { id, name, email, source } = c as Partial<CcBccContact>;
      if (typeof email !== 'string' || !EMAIL_RE.test(email)) continue;
      out.push({
        id: typeof id === 'string' && id ? id : `manual:${email.toLowerCase()}`,
        name: typeof name === 'string' ? name : email,
        email,
        source: source === 'congress' || source === 'client' ? source : 'manual',
      });
    }
    return out.length ? out : undefined;
  };
  const contactMap = (v: unknown): Record<string, CcBccContact[]> | undefined => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const map: Record<string, CcBccContact[]> = {};
    for (const [k, vals] of Object.entries(v as Record<string, unknown>)) {
      const list = contacts(vals);
      if (list) map[k] = list;
    }
    return Object.keys(map).length ? map : undefined;
  };
  const out: OutreachTarget[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const t = entry as Partial<OutreachTarget>;
    if (t.type !== 'individual' && t.type !== 'list' && t.type !== 'group') continue;
    const recipients = Array.isArray(t.recipients)
      ? t.recipients.filter((r): r is OutreachRecipient => !!r && typeof r === 'object')
      : [];
    if (recipients.length === 0) continue;
    out.push({
      key: typeof t.key === 'string' && t.key ? t.key : newTargetKey(),
      type: t.type,
      audienceId: typeof t.audienceId === 'string' ? t.audienceId : undefined,
      name: typeof t.name === 'string' ? t.name : undefined,
      recipients,
      cc: strings(t.cc),
      bcc: strings(t.bcc),
      ccContacts: contacts(t.ccContacts),
      bccContacts: contacts(t.bccContacts),
      memberCc: memberMap(t.memberCc),
      memberBcc: memberMap(t.memberBcc),
      memberCcContacts: contactMap(t.memberCcContacts),
      memberBccContacts: contactMap(t.memberBccContacts),
    });
  }
  return out;
}

/**
 * Project targets onto the legacy flat recipient array consumed by the
 * context/generate/send steps. Per-email cc/bcc = target copies (incl.
 * entire-list ccContacts) + (list only) per-member copies, deduped. A person
 * present in more than one target is emitted once (first occurrence wins)
 * because the downstream generatedEmails map is keyed by recipientKey.
 */
export function flattenTargets(targets: OutreachTarget[]): OutreachRecipient[] {
  const out: OutreachRecipient[] = [];
  const seen = new Set<string>();
  for (const type of ['individual', 'list', 'group'] as const) {
    for (const t of targets) {
      if (t.type !== type) continue;

      // A GROUP is ONE shared email: emit a single representative recipient
      // (id `group:<key>`) that carries every member in `groupMembers` (the To
      // field at send). Members are NOT deduped against individual/list targets
      // — a person can receive their own personalized email AND appear on the
      // group's To (the relaxed-dedup edge case).
      if (t.type === 'group') {
        const members = t.recipients
          .map((r) => ({ email: (r.email ?? '').trim(), name: r.name || undefined }))
          .filter((m) => m.email);
        if (!members.length) continue;
        const repId = `group:${t.key}`;
        if (seen.has(repId)) continue;
        seen.add(repId);
        const cc = dedupeEmails([...t.cc, ...(t.ccContacts?.map((c) => c.email) ?? [])]);
        const bcc = dedupeEmails([...t.bcc, ...(t.bccContacts?.map((c) => c.email) ?? [])]);
        out.push({
          id: repId,
          name: t.name ?? 'Group',
          email: members[0]!.email, // representative; send uses groupMembers for To
          groupMembers: members,
          cc: cc.length ? cc : undefined,
          bcc: bcc.length ? bcc : undefined,
          sourceLabel: `Group: ${t.name ?? 'Untitled'}`,
        });
        continue;
      }

      for (const r of t.recipients) {
        const key = recipientKey(r);
        if (seen.has(key)) continue;
        seen.add(key);
        const cc = dedupeEmails([
          ...t.cc,
          ...(t.ccContacts?.map((c) => c.email) ?? []),
          ...(t.type === 'list' ? (t.memberCc?.[key] ?? []) : []),
          ...(t.type === 'list' ? (t.memberCcContacts?.[key]?.map((c) => c.email) ?? []) : []),
        ]);
        const bcc = dedupeEmails([
          ...t.bcc,
          ...(t.bccContacts?.map((c) => c.email) ?? []),
          ...(t.type === 'list' ? (t.memberBcc?.[key] ?? []) : []),
          ...(t.type === 'list' ? (t.memberBccContacts?.[key]?.map((c) => c.email) ?? []) : []),
        ]);
        out.push({
          ...r,
          cc: cc.length ? cc : undefined,
          bcc: bcc.length ? bcc : undefined,
          sourceLabel: t.type === 'individual' ? r.sourceLabel : `List: ${t.name ?? 'Untitled'}`,
        });
      }
    }
  }
  return out;
}

/**
 * Context-item scope (Build Context step) is one of:
 *   'all'                — shared with every recipient
 *   '<recipientKey>'     — one individual
 *   'list:<targetKey>'   — a whole list (applied to each member individually)
 *   'group:<targetKey>'  — a group (the group's one shared email)
 *
 * The generate/send backend routes context by matching scope to a recipient's
 * key, so list/group scopes must be EXPANDED into per-member-keyed copies
 * before they're sent. 'all' and bare-recipientKey scopes pass through
 * unchanged; an item scoped to a list/group that no longer exists is dropped.
 * Generic so it works on both the wizard's SelectedContextItem and the saved
 * contextPool projection.
 */
export function expandContextItemScopes<T extends { scope: 'all' | string }>(
  items: T[],
  targets: OutreachTarget[],
): T[] {
  const out: T[] = [];
  for (const item of items) {
    const s = item.scope;
    const type: TargetType | null = s.startsWith('list:')
      ? 'list'
      : s.startsWith('group:')
        ? 'group'
        : null;
    if (!type) {
      out.push(item); // 'all' or an individual recipientKey — unchanged
      continue;
    }
    const key = s.slice(s.indexOf(':') + 1);
    const target = targets.find((t) => t.type === type && t.key === key);
    if (!target) continue; // scoped to a removed list/group — drop the orphan
    for (const r of target.recipients) out.push({ ...item, scope: recipientKey(r) });
  }
  return out;
}
