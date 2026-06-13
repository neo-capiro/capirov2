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
  /** List targets only: extra copies for one member, keyed by recipientKey. */
  memberCc?: Record<string, string[]>;
  memberBcc?: Record<string, string[]>;
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

/** First target containing this person, scanning individuals → lists → groups. */
export function membershipOf(targets: OutreachTarget[], key: string): TargetType | null {
  for (const type of ['individual', 'list', 'group'] as const) {
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
      memberCc: memberMap(t.memberCc),
      memberBcc: memberMap(t.memberBcc),
    });
  }
  return out;
}

/**
 * Project targets onto the legacy flat recipient array consumed by the
 * context/generate/send steps. Per-email cc/bcc = target copies + (list
 * only) member copies + campaign-global copies, deduped. A person present
 * in more than one target is emitted once (first occurrence wins) because
 * the downstream generatedEmails map is keyed by recipientKey.
 */
export function flattenTargets(
  targets: OutreachTarget[],
  globalCc: string[],
  globalBcc: string[],
): OutreachRecipient[] {
  const out: OutreachRecipient[] = [];
  const seen = new Set<string>();
  for (const type of ['individual', 'list', 'group'] as const) {
    for (const t of targets) {
      if (t.type !== type) continue;
      for (const r of t.recipients) {
        const key = recipientKey(r);
        if (seen.has(key)) continue;
        seen.add(key);
        const cc = dedupeEmails([
          ...t.cc,
          ...(t.type === 'list' ? (t.memberCc?.[key] ?? []) : []),
          ...globalCc,
        ]);
        const bcc = dedupeEmails([
          ...t.bcc,
          ...(t.type === 'list' ? (t.memberBcc?.[key] ?? []) : []),
          ...globalBcc,
        ]);
        out.push({
          ...r,
          cc: cc.length ? cc : undefined,
          bcc: bcc.length ? bcc : undefined,
          sourceLabel:
            t.type === 'individual'
              ? r.sourceLabel
              : `${t.type === 'list' ? 'List' : 'Group'}: ${t.name ?? 'Untitled'}`,
        });
      }
    }
  }
  return out;
}
