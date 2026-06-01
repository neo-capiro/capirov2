import { Injectable, Logger } from '@nestjs/common';
import { hasFirstAndLast } from './press-release-personnel-extractor.service.js';

/**
 * Hearing-witness personnel extractor (Step 34A).
 *
 * Pure, deterministic, fully unit-testable — NO LLM. `committee_hearing.witnesses`
 * is a Postgres String[] (plain witness strings like
 * "Hon. Jane Smith, Under Secretary of Defense for Acquisition and Sustainment"),
 * NOT a JSON array of structured objects (the step prompt's assumption). So the DoD
 * filter and name/title/org split run over the witness string itself.
 *
 * Pipeline per hearing:
 *   1. Caller pre-filters hearings to defense committees + last-12-months (in the runner
 *      query); `isDefenseCommittee` is exposed here so the runner and tests share it.
 *   2. For each witness string: split "<name>, <title/org remainder>" on the first comma.
 *   3. Keep only DoD-affiliated witnesses (string matches a DoD-org keyword).
 *   4. Validate the name has first+last (reuses the press extractor's helper).
 *   5. Emit PersonRecordInput-shaped rows for the writer (source='hearing_witness',
 *      confidence=0.9), observedAt = hearing date (writer idempotency key).
 */

export interface HearingInput {
  committeeName: string;
  committeeCode: string | null;
  title: string;
  date: Date;
  url: string | null;
  witnesses: string[];
}

export interface ExtractedHearingPerson {
  fullName: string;
  title: string | null;
  organization: string | null;
  sourceUrl: string | undefined;
  snippet: string;
  observedAt: Date;
  confidence: number;
}

export const HEARING_WITNESS_SOURCE = 'hearing_witness';
export const HEARING_WITNESS_CONFIDENCE = 0.9;

/**
 * Defense-committee detection. Matches HASC / SASC and the defense appropriations
 * subcommittees (HAC-D / SAC-D) by committee name OR committee code, case-insensitive.
 * Deliberately broad on name phrasing because sync-hearings stores full human names
 * like "House Armed Services Committee" / "Defense Subcommittee".
 */
const DEFENSE_COMMITTEE_PATTERNS: RegExp[] = [
  /\barmed services\b/i, // HASC / SASC full names
  /\bHASC\b/i,
  /\bSASC\b/i,
  /\bHAC[-\s]?D\b/i,
  /\bSAC[-\s]?D\b/i,
  /\bdefense\b.*\b(appropriation|subcommittee)/i,
  /\b(appropriation|subcommittee)\b.*\bdefense\b/i,
];

// Committee-code prefixes used by the House/Senate clerks for the relevant panels.
// HASC = AS00 (House), SASC = SSAS (Senate); appropriations defense subcommittees vary,
// so codes are a supplement to the name match, not the sole signal.
const DEFENSE_COMMITTEE_CODES: RegExp[] = [/^AS/i, /^SSAS/i, /^HAP/i, /^SSAP/i];

/**
 * DoD-affiliation keywords. A witness is kept only if their string mentions one.
 * Word-boundaried where ambiguous (e.g. "Navy" must not match "Navy Pier" — acceptable
 * for this domain). Ordered roughly by frequency.
 */
const DOD_ORG_PATTERNS: RegExp[] = [
  /\bDepartment of Defense\b/i,
  /\bDoD\b/i,
  /\bU\.?S\.? Army\b/i,
  /\bArmy\b/i,
  /\bU\.?S\.? Navy\b/i,
  /\bNavy\b/i,
  /\bAir Force\b/i,
  /\bMarine Corps\b/i,
  /\bMarines\b/i,
  /\bSpace Force\b/i,
  /\bDARPA\b/i,
  /\bMissile Defense Agency\b/i,
  /\bMDA\b/i,
  /\bDISA\b/i,
  /\bDLA\b/i,
  /\bDTRA\b/i,
  /\bSOCOM\b/i,
  /\bCYBERCOM\b/i,
  /\bUnder Secretary of Defense\b/i,
  /\bAssistant Secretary of (the )?(Defense|Army|Navy|Air Force)\b/i,
  /\bSecretary of (the )?(Defense|Army|Navy|Air Force)\b/i,
  /\bOSD\b/i,
  /\bOffice of the Secretary of Defense\b/i,
  /\bJoint (Chiefs|Staff)\b/i,
  /\bcombatant command\b/i,
  /\bUSD\b/i, // Under Secretary of Defense abbreviation
  /\bPEO\b/i, // Program Executive Officer — defense-specific
];

@Injectable()
export class HearingPersonnelExtractorService {
  private readonly logger = new Logger(HearingPersonnelExtractorService.name);

  /** True if the committee is a defense panel (HASC/SASC/HAC-D/SAC-D), by name or code. */
  isDefenseCommittee(committeeName: string, committeeCode: string | null): boolean {
    const name = committeeName ?? '';
    if (DEFENSE_COMMITTEE_PATTERNS.some((re) => re.test(name))) return true;
    const code = (committeeCode ?? '').trim();
    if (code && DEFENSE_COMMITTEE_CODES.some((re) => re.test(code))) return true;
    return false;
  }

  /** True if a witness string mentions a DoD-affiliated organization. */
  isDodWitness(witness: string): boolean {
    return DOD_ORG_PATTERNS.some((re) => re.test(witness));
  }

  /**
   * Split a witness string into name + title/org remainder. Witness strings are
   * conventionally "<Name>, <Title>, <Organization>". We take the first token group
   * before the first comma as the name and the remainder as title/org context.
   */
  parseWitness(witness: string): { fullName: string; title: string | null; organization: string | null } {
    const cleaned = (witness ?? '').replace(/\s+/g, ' ').trim();
    const firstComma = cleaned.indexOf(',');
    if (firstComma < 0) {
      return { fullName: cleaned, title: null, organization: null };
    }
    const fullName = cleaned.slice(0, firstComma).trim();
    const remainder = cleaned.slice(firstComma + 1).trim();
    // Heuristic: if there's a second comma, treat "title, organization"; else all title.
    const secondComma = remainder.indexOf(',');
    if (secondComma < 0) {
      return { fullName, title: remainder || null, organization: null };
    }
    return {
      fullName,
      title: remainder.slice(0, secondComma).trim() || null,
      organization: remainder.slice(secondComma + 1).trim() || null,
    };
  }

  /**
   * Extract validated DoD person records from one hearing's witness list.
   * Returns [] for non-defense committees or hearings with no DoD witnesses.
   */
  extractFromHearing(hearing: HearingInput): ExtractedHearingPerson[] {
    if (!this.isDefenseCommittee(hearing.committeeName, hearing.committeeCode)) return [];

    const out: ExtractedHearingPerson[] = [];
    const seen = new Set<string>();
    const dateStr = hearing.date.toISOString().slice(0, 10);

    for (const raw of hearing.witnesses ?? []) {
      const witness = (raw ?? '').trim();
      if (!witness) continue;
      if (!this.isDodWitness(witness)) continue;

      const { fullName, title, organization } = this.parseWitness(witness);
      if (!fullName || !hasFirstAndLast(fullName)) continue;

      // De-dup within a single hearing (same person listed twice).
      const key = fullName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        fullName,
        title,
        organization,
        sourceUrl: hearing.url ?? undefined,
        snippet: `testified at ${hearing.title} on ${dateStr}`.slice(0, 500),
        observedAt: hearing.date,
        confidence: HEARING_WITNESS_CONFIDENCE,
      });
    }
    return out;
  }
}
