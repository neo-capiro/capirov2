/**
 * Pure logic for (a) retiring stale old-DoW-directory Program Elements and
 * (b) repairing person->PE links during the cleanup. No I/O — the reconcile /
 * repair scripts gather the signals and act on these decisions.
 *
 * A PE still bearing source='stanford_pe_directory_jan2026' is, by definition, one
 * the authoritative sources never re-asserted: the J-book writer overwrites `source`
 * on every PE it upserts, so anything the J-book (or P-doc, committee mark, etc.)
 * touched was relabeled away from the stanford tag. We retire such a PE ONLY when it
 * also carries no live signal — never a blind delete, and real-but-uncovered PEs are
 * kept (they have a year row, award, bill, watch, citation, project, or a current
 * person pointing at them).
 */

/** The old spreadsheet's PE source tag (the only PEs this cleanup ever touches). */
export const DEPRECATED_PE_SOURCE = 'stanford_pe_directory_jan2026';

export interface PeRetireSignals {
  source: string;
  retiredAt: Date | string | null;
  /** People with pePrimary/peSecondary = this code who are NOT superseded. Run the
   *  personnel supersede first so a PE pointed at only by stale people scores 0 here. */
  linkedActivePersonCount: number;
  yearRowCount: number;
  awardCount: number;
  billCount: number;
  watchCount: number;
  capabilityCount: number;
  procurementLineCount: number;
  jbookCitationCount: number;
  projectCount: number;
}

export type PeRetireAction = 'retire' | 'keep' | 'skip';

export interface PeRetireDecision {
  action: PeRetireAction;
  reason: string;
}

/** Any signal that a PE is real / in use beyond the old spreadsheet row itself. */
export function hasLiveSignal(p: PeRetireSignals): boolean {
  return (
    p.linkedActivePersonCount > 0 ||
    p.yearRowCount > 0 ||
    p.awardCount > 0 ||
    p.billCount > 0 ||
    p.watchCount > 0 ||
    p.capabilityCount > 0 ||
    p.procurementLineCount > 0 ||
    p.jbookCitationCount > 0 ||
    p.projectCount > 0
  );
}

export function classifyPeRetire(p: PeRetireSignals): PeRetireDecision {
  if (p.retiredAt) return { action: 'skip', reason: 'already_retired' };
  if (p.source !== DEPRECATED_PE_SOURCE) {
    return { action: 'skip', reason: 'not_old_spreadsheet_pe' };
  }
  if (hasLiveSignal(p)) return { action: 'keep', reason: 'has_live_signal' };
  return { action: 'retire', reason: 'old_spreadsheet_only_no_live_signal' };
}

// ── Person -> PE link repair ────────────────────────────────────────────────

export interface LinkRepairInput {
  pePrimary: string | null;
  peSecondary: string[];
  /** A PE code is authoritative for linking if it still exists and isn't retired. */
  isAuthoritativePe: (peCode: string) => boolean;
  /** True iff pePrimary was set by a human (confirmed candidate / pe_match_confirmed
   *  source) rather than baked in by the old spreadsheet import. Trusted links are
   *  never auto-cleared. peSecondary is never human-confirmed (the candidate flow
   *  only ever sets pePrimary), so it is repaired purely on authority. */
  pePrimaryTrusted: boolean;
}

export interface LinkRepairDecision {
  clearPrimary: boolean;
  newPeSecondary: string[];
  changed: boolean;
  reason: string;
}

export function decideLinkRepair(p: LinkRepairInput): LinkRepairDecision {
  const clearPrimary = !!p.pePrimary && !p.isAuthoritativePe(p.pePrimary) && !p.pePrimaryTrusted;

  const newPeSecondary = (p.peSecondary ?? []).filter((c) => p.isAuthoritativePe(c));
  const secondaryChanged = newPeSecondary.length !== (p.peSecondary ?? []).length;
  const changed = clearPrimary || secondaryChanged;

  let reason = 'no_change';
  if (clearPrimary && secondaryChanged) reason = 'cleared_primary_and_stripped_secondary';
  else if (clearPrimary) reason = 'cleared_unauthoritative_untrusted_primary';
  else if (secondaryChanged) reason = 'stripped_unauthoritative_secondary';
  else if (p.pePrimary && !p.isAuthoritativePe(p.pePrimary) && p.pePrimaryTrusted) {
    reason = 'kept_trusted_primary_despite_unauthoritative_target';
  }

  return { clearPrimary, newPeSecondary, changed, reason };
}
