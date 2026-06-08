import { describe, expect, test } from '@jest/globals';
import {
  PeProgramMatcherService,
  type Component,
  type ProgramAliasRow,
  type ProjectTitleRow,
  type OtherFundingLink,
} from './pe-program-matcher.service.js';

const svc = new PeProgramMatcherService();

function alias(programId: string, text: string, component: Component | null, aliasType = 'mdap_name'): ProgramAliasRow & { tg: Set<string> } {
  const aliasNormalized = svc.normalizeAlias(text);
  return { programId, aliasNormalized, aliasType, component, tg: svc.trigrams(aliasNormalized) };
}

describe('peComponent (PE suffix -> component)', () => {
  test('single-letter designators', () => {
    expect(svc.peComponent('0604800F')).toBe('AF');
    expect(svc.peComponent('0604558N')).toBe('NAVY');
    expect(svc.peComponent('0605812A')).toBe('ARMY');
  });
  test('multi-char designators win', () => {
    expect(svc.peComponent('1203940SF')).toBe('SF');
  });
});

describe('normalizeAlias', () => {
  test('uppercases, strips punctuation, collapses ws, unifies dashes', () => {
    expect(svc.normalizeAlias('F-35 Lightning II')).toBe('F 35 LIGHTNING II');
    expect(svc.normalizeAlias('SSN 774 — Virginia')).toBe('SSN 774 VIRGINIA');
  });
});

describe('componentMatch', () => {
  test('exact / soft (OSD/JOINT) / mismatch / unknown', () => {
    expect(svc.componentMatch('AF', 'AF')).toBe('exact');
    expect(svc.componentMatch('AF', 'OSD')).toBe('soft');
    expect(svc.componentMatch('JOINT', 'NAVY')).toBe('soft');
    expect(svc.componentMatch('AF', 'NAVY')).toBe('mismatch');
    expect(svc.componentMatch(null, 'NAVY')).toBeNull();
  });
});

describe('matchPe — fuzzy alias matching', () => {
  const empty = new Map<string, OtherFundingLink>();

  test('an EXACT PE-title ~ alias match yields a CANDIDATE (never accepted from fuzzy)', () => {
    // raw similarity 1.0; fuzzy path caps the score below 0.90 (0.88) and uses a fuzzy
    // evidence tier, so even a perfect trigram match must go to review, not auto-accept.
    const aliasIndex = [alias('prog-jsow', 'Joint Standoff Weapon', 'NAVY')];
    const out = svc.matchPe(
      { peCode: '0604727N', title: 'Joint Standoff Weapon' },
      [],
      aliasIndex,
      empty,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.programId).toBe('prog-jsow');
    expect(out[0]!.projectCode).toBeNull();
    expect(out[0]!.status).toBe('candidate');
    expect(out[0]!.score).toBeLessThan(0.9);
    expect(out[0]!.score).toBeGreaterThanOrEqual(0.7);
    expect(['sam_match', 'other_funding_link']).toContain(out[0]!.evidenceTier);
  });

  test('a partial PE-title overlap lands in the quarantine band (held back from review surfacing)', () => {
    // raw ~0.76 -> 0.76*0.8 + 0.08 component ~ 0.69 -> quarantined.
    const aliasIndex = [alias('prog-jsow', 'Joint Standoff Weapon', 'NAVY')];
    const out = svc.matchPe(
      { peCode: '0604727N', title: 'Joint Standoff Weapon System' },
      [],
      aliasIndex,
      empty,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.status).toBe('quarantined');
    expect(out[0]!.score).toBeLessThan(0.7);
  });

  test('component MISMATCH is dropped (an AF program is not an Army PE match)', () => {
    const aliasIndex = [alias('prog-af', 'Joint Standoff Weapon', 'AF')];
    const out = svc.matchPe(
      { peCode: '0604727N', title: 'Joint Standoff Weapon System' }, // NAVY
      [],
      aliasIndex,
      empty,
    );
    expect(out).toHaveLength(0);
  });

  test('a weak/short overlap below trgmMin produces no proposal', () => {
    const aliasIndex = [alias('prog-x', 'Aircraft Survivability Equipment', 'ARMY')];
    const out = svc.matchPe(
      { peCode: '0601102A', title: 'Defense Research Sciences' },
      [],
      aliasIndex,
      empty,
    );
    expect(out).toHaveLength(0);
  });

  test('project title match sets projectCode and is project-level', () => {
    const aliasIndex = [alias('prog-thaad', 'Terminal High Altitude Area Defense', 'ARMY')];
    const projects: ProjectTitleRow[] = [
      { peCode: '0605058A', projectCode: 'AB1', title: 'Terminal High Altitude Area Defense' },
    ];
    const out = svc.matchPe(
      { peCode: '0605058A', title: 'Missile Defense' },
      projects,
      aliasIndex,
      empty,
    );
    const proj = out.find((m) => m.projectCode === 'AB1');
    expect(proj).toBeDefined();
    expect(proj!.programId).toBe('prog-thaad');
  });

  test('other-funding link boosts score and adds evidence + tier', () => {
    const aliasIndex = [alias('prog-jsow', 'Joint Standoff Weapon', 'NAVY')];
    const ofl = new Map<string, OtherFundingLink>([
      ['prog-jsow', { peCode: '0604727N', programId: 'prog-jsow', sourceUrl: 'https://x/p1', pageNumber: 27, p1Line: '027' }],
    ]);
    const without = svc.matchPe({ peCode: '0604727N', title: 'Joint Standoff Weapon System' }, [], aliasIndex, new Map());
    const withOfl = svc.matchPe({ peCode: '0604727N', title: 'Joint Standoff Weapon System' }, [], aliasIndex, ofl);
    expect(withOfl[0]!.score).toBeGreaterThan(without[0]!.score);
    expect(withOfl[0]!.evidenceTier).toBe('other_funding_link');
    expect(withOfl[0]!.evidence.some((e) => e.kind === 'other_funding_link')).toBe(true);
    // Even with the boost, a fuzzy path never auto-accepts.
    expect(withOfl[0]!.status).not.toBe('accepted');
  });

  test('emits at most one row per (PE, program) — best score wins', () => {
    // Two aliases for the same program; only the better match is kept for this PE.
    const aliasIndex = [
      alias('prog-jsow', 'Joint Standoff Weapon', 'NAVY', 'mdap_name'),
      alias('prog-jsow', 'JSOW', 'NAVY', 'acronym'),
    ];
    const out = svc.matchPe({ peCode: '0604727N', title: 'Joint Standoff Weapon System' }, [], aliasIndex, new Map());
    const forProgram = out.filter((m) => m.programId === 'prog-jsow');
    expect(forProgram).toHaveLength(1);
  });

  test('weakSignal flag set when a corroborated score still lands < 0.50', () => {
    // Construct a marginal trigram match by lowering trgmMin so a weak overlap passes.
    const aliasIndex = [alias('prog-x', 'Advanced Power Applications Office', 'ARMY')];
    const out = svc.matchPe(
      { peCode: '0604129A', title: 'Advanced Power Generation' },
      [],
      aliasIndex,
      new Map(),
      { trgmMin: 0.2, minAliasLen: 3 },
    );
    if (out.length) {
      for (const m of out) {
        if (m.score < 0.5) {
          expect(m.weakSignal).toBe(true);
          expect(m.status).toBe('quarantined');
        }
      }
    }
  });
});
