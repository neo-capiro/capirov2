import { Injectable } from '@nestjs/common';
import {
  deriveMatchStatus,
  isWeakSignal,
  type EvidenceTier,
  type MatchStatus,
} from './program-match-thresholds.js';
import { isGenericAlias } from './alias-stoplist.js';

/**
 * PE/project -> Program matcher (Step 2.1).
 *
 * Proposes NEW candidate matches into `pe_program_match` for HUMAN review, by
 * trigram-matching a Program's known aliases (aliasNormalized) against PE titles
 * and R-2A project titles, boosted by:
 *   - component agreement (a PE's service-suffix vs the program's component), and
 *   - other-funding links (a resolved P-1 line shared with a program's known lines —
 *     step 1.5), supplied by the caller as a precomputed signal.
 *
 * It NEVER auto-accepts from a fuzzy path: every fuzzy match is emitted with a
 * fuzzy evidence tier (never official+exact), so deriveMatchStatus can only ever
 * return 'candidate' or 'quarantined'. The ONLY exact paths that can reach
 * 'accepted' are an explicit PE-number / exact-project-title match (tier
 * 'exact_pe_number' / 'exact_project_title') AND a >=0.90 score — and even then the
 * matcher emits them as candidates by default unless the caller opts into the
 * documented exact path. Curated 'accepted' rows come only from seed-programs.ts.
 *
 * Pure & deterministic: no DB access in this class (the sync script supplies rows).
 * That keeps the accuracy-critical logic unit-testable, exactly like
 * PePersonMatcherService (acquisition-personnel/matching).
 */

export type Component = 'ARMY' | 'AF' | 'NAVY' | 'USMC' | 'SF' | 'DARPA' | 'OSD' | 'SOCOM' | 'CYBER' | 'JOINT';

// PE-code suffix -> canonical component. Longest-suffix-first so multi-char designators win.
// Mirrors PePersonMatcherService.SUFFIX_SVC (the DoD designator convention).
const SUFFIX_COMPONENT: Array<[string, Component]> = [
  ['SF', 'SF'], ['SE', 'OSD'], ['D8Z', 'OSD'], ['DHA', 'OSD'], ['JCY', 'CYBER'], ['KA', 'SOCOM'],
  ['BB', 'NAVY'], ['BR', 'NAVY'], ['BP', 'NAVY'], ['BL', 'NAVY'], ['OTE', 'OSD'],
  ['A', 'ARMY'], ['F', 'AF'], ['N', 'NAVY'], ['M', 'USMC'], ['E', 'DARPA'], ['K', 'SOCOM'],
  ['C', 'OSD'], ['J', 'JOINT'], ['S', 'SOCOM'], ['V', 'OSD'], ['D', 'OSD'], ['X', 'OSD'], ['T', 'OSD'], ['R', 'OSD'],
];

/** One alias of a program, with its program id + the program's component. */
export interface ProgramAliasRow {
  programId: string;
  /** Upper-cased, punctuation-stripped form (normalizeAlias output). */
  aliasNormalized: string;
  aliasType: string;
  component: Component | null;
}

/** A PE title (and component derived from the PE code) to match against. */
export interface PeTitleRow {
  peCode: string;
  title: string;
}

/** An R-2A project title within a PE to match against. */
export interface ProjectTitleRow {
  peCode: string;
  projectCode: string;
  title: string;
}

/**
 * Other-funding boost signal (step 1.5): for a (peCode -> programId) pair, the
 * caller has resolved that a P-1 line referenced by this PE is also one of the
 * program's known lines. Presence of this signal nudges score + records evidence.
 */
export interface OtherFundingLink {
  peCode: string;
  programId: string;
  sourceUrl?: string;
  pageNumber?: number;
  p1Line?: string;
}

export interface MatchEvidenceItem {
  kind: string;
  sourceUrl?: string;
  pageNumber?: number;
  quote?: string;
}

export interface ProposedMatch {
  peCode: string;
  projectCode: string | null;
  programId: string;
  score: number;
  evidenceTier: EvidenceTier;
  status: MatchStatus;
  weakSignal: boolean;
  matchBasis: string;
  evidence: MatchEvidenceItem[];
}

@Injectable()
export class PeProgramMatcherService {
  /** Component implied by a PE code's trailing designator (mirrors pe-person-matcher). */
  peComponent(peCode: string): Component | null {
    const m = peCode.match(/^[0-9]{7}(.+)$/);
    if (!m) return null;
    const suf = m[1]!.toUpperCase();
    for (const [k, v] of SUFFIX_COMPONENT) if (suf === k) return v;
    for (const [k, v] of SUFFIX_COMPONENT) if (suf.startsWith(k)) return v;
    return null;
  }

  /**
   * Normalize an alias / title to the comparison form: upper-case, punctuation
   * stripped, whitespace collapsed. Matches the aliasNormalized stored on
   * program_alias (so the in-memory trigram set agrees with the pg_trgm index).
   */
  normalizeAlias(s: string | null): string {
    return (s ?? '')
      .toUpperCase()
      .replace(/[‐-―−]/g, '-')
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** pg_trgm-compatible trigram set (lower-cased internally; pg_trgm is case-insensitive). */
  trigrams(s: string | null): Set<string> {
    const str = '  ' + this.normalizeAlias(s).toLowerCase() + ' ';
    const g = new Set<string>();
    for (let i = 0; i < str.length - 2; i++) g.add(str.slice(i, i + 3));
    return g;
  }

  /** Jaccard over trigram sets — matches Postgres similarity(). */
  similarity(a: string | null, b: string | null): number {
    return this.simSet(this.trigrams(a), this.trigrams(b));
  }

  private simSet(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    let inter = 0;
    for (const x of Array.from(a)) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
  }

  /** exact | soft (OSD/joint wildcard) | mismatch | null (unknown). */
  componentMatch(a: Component | null, b: Component | null): 'exact' | 'soft' | 'mismatch' | null {
    if (!a || !b) return null;
    if (a === b) return 'exact';
    if (a === 'OSD' || b === 'OSD' || a === 'JOINT' || b === 'JOINT') return 'soft';
    return 'mismatch';
  }

  /**
   * Propose matches for ONE PE (its title + projects) against the full alias universe.
   * Returns the best candidate per program (so we never emit two fuzzy rows for the
   * same PE/program pair). Aliases must carry precomputed trigram sets for performance.
   *
   * @param opts.trgmMin  minimum trigram similarity to consider a fuzzy match (default 0.45)
   * @param opts.minAliasLen  minimum normalized alias length (precision guard; default 6)
   */
  matchPe(
    pe: PeTitleRow,
    projects: ProjectTitleRow[],
    aliasIndex: Array<ProgramAliasRow & { tg: Set<string> }>,
    otherFundingByProgram: Map<string, OtherFundingLink>,
    opts: { trgmMin?: number; minAliasLen?: number } = {},
  ): ProposedMatch[] {
    const trgmMin = opts.trgmMin ?? 0.45;
    const minAliasLen = opts.minAliasLen ?? 6;
    const peComp = this.peComponent(pe.peCode);

    // Best (highest effective score) match per programId for this PE.
    const bestByProgram = new Map<string, ProposedMatch>();

    const consider = (
      programId: string,
      projectCode: string | null,
      raw: number,
      via: string,
      aliasNormalized: string,
      aliasType: string,
      programComp: Component | null,
      matchedText: string,
    ): void => {
      const cm = this.componentMatch(peComp, programComp);
      if (cm === 'mismatch') return; // a different service's program is not a match

      // Component agreement boosts; an unknown component neither boosts nor penalizes.
      // Other-funding link (step 1.5) is a strong corroborating signal.
      const ofl = otherFundingByProgram.get(programId);
      const compBoost = cm === 'exact' ? 0.08 : cm === 'soft' ? 0.03 : 0;
      const oflBoost = ofl ? 0.1 : 0;

      // Fuzzy score is capped well below 0.90 so a pure trigram path can NEVER reach
      // auto-accept; corroboration (component + other-funding) only moves it within
      // the candidate band. The fuzzy evidence tier independently forbids accept.
      let score = Math.min(0.88, raw * 0.8 + compBoost + oflBoost);
      score = Number(score.toFixed(3));

      // Evidence tier: a shared resolved P-1 line is the strongest fuzzy-path tier we
      // emit ('other_funding_link'); otherwise it is alias/usage-based ('award_usage'
      // and friends collapse to the weakest applicable fuzzy tier). None are
      // official+exact, so deriveMatchStatus can only return candidate/quarantined.
      const evidenceTier: EvidenceTier = ofl ? 'other_funding_link' : 'sam_match';

      const status = deriveMatchStatus(score, evidenceTier);
      const weakSignal = isWeakSignal(score);

      const evidence: MatchEvidenceItem[] = [
        {
          kind: `alias_trigram:${aliasType}`,
          quote: `'${matchedText}' ~ alias '${aliasNormalized}' (sim ${raw.toFixed(2)}, component ${peComp ?? '?'}/${programComp ?? '?'} ${cm ?? 'unknown'})`,
        },
      ];
      if (ofl) {
        evidence.push({
          kind: 'other_funding_link',
          sourceUrl: ofl.sourceUrl,
          pageNumber: ofl.pageNumber,
          quote: ofl.p1Line ? `shared P-1 line ${ofl.p1Line}` : 'shared resolved P-1 line',
        });
      }

      const matchBasis = `${via}: '${matchedText}' ~ '${aliasNormalized}' (sim ${raw.toFixed(2)})${ofl ? ' + other-funding link' : ''}, component ${peComp ?? '?'}/${programComp ?? '?'}`;

      const proposed: ProposedMatch = {
        peCode: pe.peCode,
        projectCode,
        programId,
        score,
        evidenceTier,
        status,
        weakSignal,
        matchBasis,
        evidence,
      };

      const prev = bestByProgram.get(programId);
      if (!prev || proposed.score > prev.score) bestByProgram.set(programId, proposed);
    };

    // ── PE title vs aliases ──
    // Skip generic accounting categories on BOTH sides: a PE titled e.g.
    // "Congressional Adds" matches nothing, and a generic alias is never evidence
    // (defense-in-depth for any generic alias that predates the creation guard).
    const peTitleNorm = this.normalizeAlias(pe.title);
    if (!isGenericAlias(peTitleNorm)) {
      const peTitleTg = this.trigrams(pe.title);
      for (const a of aliasIndex) {
        if (a.aliasNormalized.length < minAliasLen) continue;
        if (isGenericAlias(a.aliasNormalized)) continue;
        const raw = this.simSet(peTitleTg, a.tg);
        if (raw < trgmMin) continue;
        consider(a.programId, null, raw, 'pe_title', a.aliasNormalized, a.aliasType, a.component, peTitleNorm);
      }
    }

    // ── Project titles vs aliases (project-level matches; projectCode set) ──
    for (const proj of projects) {
      if (!proj.title?.trim()) continue;
      const projNorm = this.normalizeAlias(proj.title);
      if (isGenericAlias(projNorm)) continue;
      const projTg = this.trigrams(proj.title);
      for (const a of aliasIndex) {
        if (a.aliasNormalized.length < minAliasLen) continue;
        if (isGenericAlias(a.aliasNormalized)) continue;
        const raw = this.simSet(projTg, a.tg);
        if (raw < trgmMin) continue;
        consider(a.programId, proj.projectCode, raw, 'project_title', a.aliasNormalized, a.aliasType, a.component, projNorm);
      }
    }

    return Array.from(bestByProgram.values());
  }
}
