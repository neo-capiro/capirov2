import { Injectable } from '@nestjs/common';

/**
 * PE-Person matcher (program -> Program Element attribution).
 *
 * Proposes person -> Program Element links into `program_element_person_candidate`
 * for HUMAN review. NEVER writes acquisition_personnel.pe_primary directly — that
 * happens only when a reviewer confirms a candidate (resolvePersonCandidate).
 *
 * Accuracy design (validated against prod, June 2026):
 *  - PE titles are NOT unique (1,154 codes -> 1,054 distinct titles). Generic titles
 *    like "Defense Research Sciences" map to 5 codes differing only by SERVICE.
 *    Matching on title alone reintroduces the service-drift errors found in the
 *    legacy spreadsheet import (e.g. 0601102F vs 0601102SF). We therefore ALWAYS
 *    disambiguate by service, parsed from the PE-code SUFFIX (the DoD designator
 *    convention), against the person's service.
 *  - Signal 1 (peTitle): exact (punctuation/em-dash normalized) then trigram >= 0.45.
 *  - Signal 2 (organization + program_of_record): trigram vs PE title + project
 *    title, service-filtered, higher bar (>= 0.60) and a min-length guard because
 *    program_of_record is free text and short/generic strings produce spurious hits.
 *
 * Pure & deterministic: no DB access in this class (the sync script supplies rows).
 * That keeps the accuracy-critical logic unit-testable.
 */

export type Service = 'ARMY' | 'AF' | 'NAVY' | 'USMC' | 'SF' | 'DARPA' | 'OSD' | 'SOCOM' | 'CYBER' | 'JOINT';

export interface PeRow { peCode: string; title: string }
export interface PersonRow {
  id: string;
  service: string | null;
  organization: string | null;
  peTitle: string | null;       // metadata.peTitle (PDF-derived)
  programOfRecord: string | null;
}
export interface Candidate {
  personId: string;
  peCode: string;
  score: number;
  matchBasis: string;
  breakdown: Record<string, unknown>;
}

// PE-code suffix -> canonical service. Longest-suffix-first so multi-char designators win.
const SUFFIX_SVC: Array<[string, Service]> = [
  ['SF', 'SF'], ['SE', 'OSD'], ['D8Z', 'OSD'], ['DHA', 'OSD'], ['JCY', 'CYBER'], ['KA', 'SOCOM'],
  ['BB', 'NAVY'], ['BR', 'NAVY'], ['BP', 'NAVY'], ['BL', 'NAVY'], ['OTE', 'OSD'],
  ['A', 'ARMY'], ['F', 'AF'], ['N', 'NAVY'], ['M', 'USMC'], ['E', 'DARPA'], ['K', 'SOCOM'],
  ['C', 'OSD'], ['J', 'JOINT'], ['S', 'SOCOM'], ['V', 'OSD'], ['D', 'OSD'], ['X', 'OSD'], ['T', 'OSD'], ['R', 'OSD'],
];

@Injectable()
export class PePersonMatcherService {
  /** Service implied by a PE code's trailing designator. */
  peService(peCode: string): Service | null {
    const m = peCode.match(/^[0-9]{7}(.+)$/);
    if (!m) return null;
    const suf = m[1]!.toUpperCase();
    for (const [k, v] of SUFFIX_SVC) if (suf === k) return v;
    for (const [k, v] of SUFFIX_SVC) if (suf.startsWith(k)) return v;
    return null;
  }

  /** Person's service from the explicit field, falling back to org-string heuristics. */
  personService(svc: string | null, org: string | null): Service | null {
    const s = (svc ?? '').toUpperCase();
    if (['ARMY', 'AF', 'NAVY', 'USMC', 'SF', 'DARPA', 'OSD'].includes(s)) return s as Service;
    if (s === 'SPACE FORCE') return 'SF';
    const o = (org ?? '').toLowerCase();
    if (/\barmy\b/.test(o)) return 'ARMY';
    if (/air force|\bafmc\b|\bafrl\b|\baflcmc\b/.test(o)) return 'AF';
    if (/\bnavy\b|naval|navsup|navair|navsea|\bnavwar\b|\boni\b/.test(o)) return 'NAVY';
    if (/marine/.test(o)) return 'USMC';
    if (/space force|\bussf\b|space operations/.test(o)) return 'SF';
    if (/darpa/.test(o)) return 'DARPA';
    if (/socom|special operations/.test(o)) return 'SOCOM';
    if (/cyber/.test(o)) return 'CYBER';
    if (/\bosd\b|secretary of defense|defense-wide|washington headquarters|\bomb\b/.test(o)) return 'OSD';
    return null;
  }

  /** exact | soft (OSD/defense-wide wildcard) | mismatch | null (unknown). */
  svcMatch(a: Service | null, b: Service | null): 'exact' | 'soft' | 'mismatch' | null {
    if (!a || !b) return null;
    if (a === b) return 'exact';
    if (a === 'OSD' || b === 'OSD') return 'soft';
    return 'mismatch';
  }

  /** Normalize a title for comparison: unify dashes, strip punctuation, collapse ws. */
  norm(s: string | null): string {
    return (s ?? '')
      .toLowerCase()
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** pg_trgm-compatible trigram set (2 leading + 1 trailing pad on normalized text). */
  trigrams(s: string | null): Set<string> {
    const str = '  ' + this.norm(s) + ' ';
    const g = new Set<string>();
    for (let i = 0; i < str.length - 2; i++) g.add(str.slice(i, i + 3));
    return g;
  }

  /** Jaccard over trigram sets — matches Postgres similarity(). */
  similarity(a: string | null, b: string | null): number {
    const A = this.trigrams(a), B = this.trigrams(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const x of Array.from(A)) if (B.has(x)) inter++;
    return inter / (A.size + B.size - inter);
  }

  /**
   * Produce candidate links for one person against the full PE universe.
   * peIndex / projectIndex carry precomputed trigram sets for performance.
   */
  matchPerson(
    person: PersonRow,
    peIndex: Array<{ peCode: string; norm: string; tg: Set<string>; svc: Service | null }>,
    byNormTitle: Map<string, string[]>,
    projectIndex: Array<{ peCode: string; tg: Set<string>; svc: Service | null }>,
    opts = { s1TrgmMin: 0.45, s2Min: 0.6 },
  ): Candidate[] {
    const pSvc = this.personService(person.service, person.organization);
    const out: Candidate[] = [];

    // ---- SIGNAL 1: peTitle ----
    if (person.peTitle) {
      const nk = this.norm(person.peTitle);
      const ptg = this.trigrams(person.peTitle);
      let codes = byNormTitle.get(nk);
      let sig = '1a_exact';
      let base: number | null = 0.95;
      let simMap: Record<string, number> | null = null;
      if (!codes || !codes.length) {
        const scored = peIndex
          .map((p) => ({ c: p.peCode, sim: this.simSet(ptg, p.tg) }))
          .filter((x) => x.sim >= opts.s1TrgmMin)
          .sort((a, b) => b.sim - a.sim)
          .slice(0, 6);
        if (scored.length) {
          codes = scored.map((s) => s.c);
          sig = '1b_trgm';
          base = null;
          simMap = Object.fromEntries(scored.map((s) => [s.c, s.sim]));
        }
      }
      if (codes && codes.length) this.resolve(out, person.id, codes, pSvc, sig, base, simMap, person.peTitle);
    }

    // ---- SIGNAL 2: organization + program_of_record ----
    if (!out.length && person.programOfRecord) {
      const q = this.trigrams(person.programOfRecord);
      let best: { c: string; eff: number; raw: number; via: string; m: ReturnType<PePersonMatcherService['svcMatch']> } | null = null;
      for (const p of peIndex) {
        const m = this.svcMatch(pSvc, p.svc);
        if (m === 'mismatch') continue;
        const raw = this.simSet(q, p.tg);
        const eff = raw * (m === 'exact' ? 1 : 0.92);
        if (!best || eff > best.eff) best = { c: p.peCode, eff, raw, via: 'pe_title', m };
      }
      for (const p of projectIndex) {
        const m = this.svcMatch(pSvc, p.svc);
        if (m === 'mismatch') continue;
        const raw = this.simSet(q, p.tg);
        const eff = raw * (m === 'exact' ? 1 : 0.92);
        if (!best || eff > best.eff) best = { c: p.peCode, eff, raw, via: 'project_title', m };
      }
      const cleanedLen = this.norm(person.programOfRecord).replace(/[^a-z0-9]/g, '').length;
      if (best && best.raw >= opts.s2Min && cleanedLen >= 12) {
        const score = Number(Math.min(0.85, 0.45 + best.raw * 0.45).toFixed(3));
        out.push({
          personId: person.id, peCode: best.c, score,
          matchBasis: `2_${best.via}: program_of_record ~ PE (sim ${best.raw.toFixed(2)}, svc ${pSvc}/${best.m})`,
          breakdown: { signal: `2_${best.via}`, personService: pSvc, sim: best.raw, svcMatch: best.m },
        });
      }
    }
    return out;
  }

  private simSet(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    let i = 0;
    for (const x of Array.from(a)) if (b.has(x)) i++;
    return i / (a.size + b.size - i);
  }

  private resolve(
    out: Candidate[], id: string, codes: string[], pSvc: Service | null,
    sig: string, base: number | null, simMap: Record<string, number> | null, pt: string,
  ): void {
    if (codes.length === 1) {
      const only = codes[0]!;
      const sc = base ?? Math.min(0.9, 0.5 + (simMap?.[only] ?? 0) * 0.45);
      out.push({ personId: id, peCode: only, score: Number(sc.toFixed(3)), matchBasis: `${sig}: '${pt}' -> unique`, breakdown: { signal: `${sig}_unique`, personService: pSvc, sim: simMap ? simMap[only] : 1 } });
      return;
    }
    const scored = codes.map((c) => ({ c, m: this.svcMatch(pSvc, this.peService(c)), sim: simMap ? simMap[c] : 1 }));
    const exact = scored.filter((x) => x.m === 'exact');
    if (exact.length === 1) {
      const e = exact[0]!;
      const sc = base ? 0.9 : Math.min(0.88, 0.5 + (e.sim ?? 0) * 0.45);
      out.push({ personId: id, peCode: e.c, score: Number(sc.toFixed(3)), matchBasis: `${sig}: '${pt}' ambiguous(${codes.length}); svc ${pSvc} -> ${e.c}`, breakdown: { signal: `${sig}_svc_disambig`, personService: pSvc, candidates: codes, sim: e.sim } });
    } else if (exact.length > 1) {
      for (const x of exact) out.push({ personId: id, peCode: x.c, score: 0.55, matchBasis: `${sig}: svc ${pSvc} ties ${exact.length}`, breakdown: { signal: `${sig}_svc_tie`, personService: pSvc, candidates: exact.map((e) => e.c) } });
    } else {
      for (const x of scored) out.push({ personId: id, peCode: x.c, score: 0.4, matchBasis: `${sig}: no svc disambig (person=${pSvc})`, breakdown: { signal: `${sig}_no_svc`, personService: pSvc, candidates: codes } });
    }
  }
}
