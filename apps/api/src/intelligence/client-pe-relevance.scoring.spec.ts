import {
  combineRelevance,
  DIVERSITY_STEP,
  ECOSYSTEM_SCORE,
  FACILITY_DISTRICT_SCORE,
  MAX_DIVERSITY_BONUS,
  PathResult,
  PE_DIRECT_SCORE,
  PRIOR_AWARD_BASE_SCORE,
  PRIOR_AWARD_MAX_SCORE,
  scoreCapabilityKeyword,
  scoreCapabilityPeDirect,
  scoreEcosystem,
  scoreFacilityDistrict,
  scorePriorAward,
  STRONG_PATH_FLOOR,
} from './client-pe-relevance.scoring.js';

/** Assert a score is a finite number inside the inclusive [0,1] band. */
function expectInUnitInterval(score: number): void {
  expect(Number.isFinite(score)).toBe(true);
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(1);
}

describe('client-pe-relevance scoring — per-path scorers', () => {
  describe('scoreCapabilityPeDirect', () => {
    test('full score when PE numbers matched, evidence lists them', () => {
      const r = scoreCapabilityPeDirect({ matchedPeNumbers: ['0604256F', '0207141F'] });
      expect(r).not.toBeNull();
      expect(r!.path).toBe('capability_pe_direct');
      expect(r!.score).toBe(PE_DIRECT_SCORE);
      expect(r!.score).toBe(1.0);
      expect(r!.evidence.join(' ')).toContain('0604256F');
      expect(r!.evidence.join(' ')).toContain('0207141F');
      expectInUnitInterval(r!.score);
    });

    test('null when no PE numbers', () => {
      expect(scoreCapabilityPeDirect({ matchedPeNumbers: [] })).toBeNull();
    });
  });

  describe('scoreCapabilityKeyword', () => {
    test('clamps similarity into [0,1] and lists keywords', () => {
      const r = scoreCapabilityKeyword({
        matchedKeywords: ['hypersonics', 'glide body'],
        maxSimilarity: 0.72,
      });
      expect(r).not.toBeNull();
      expect(r!.path).toBe('capability_keyword');
      expect(r!.score).toBe(0.72);
      expect(r!.evidence.join(' ')).toContain('hypersonics');
      expect(r!.evidence.join(' ')).toContain('glide body');
      expectInUnitInterval(r!.score);
    });

    test('clamps an over-range similarity down to 1', () => {
      const r = scoreCapabilityKeyword({ matchedKeywords: ['ew'], maxSimilarity: 1.5 });
      expect(r!.score).toBe(1);
      expectInUnitInterval(r!.score);
    });

    test('clamps a negative similarity up to 0', () => {
      const r = scoreCapabilityKeyword({ matchedKeywords: ['ew'], maxSimilarity: -0.3 });
      expect(r!.score).toBe(0);
    });

    test('null when no keywords matched', () => {
      expect(
        scoreCapabilityKeyword({ matchedKeywords: [], maxSimilarity: 0.9 }),
      ).toBeNull();
    });
  });

  describe('scorePriorAward', () => {
    test('base score for a single award', () => {
      const r = scorePriorAward({ awardCount: 1, totalAmountUsd: 250_000 });
      expect(r).not.toBeNull();
      expect(r!.path).toBe('prior_award');
      expect(r!.score).toBe(PRIOR_AWARD_BASE_SCORE);
      expect(r!.score).toBe(0.8);
      expect(r!.evidence[0]).toContain('1 prior award');
      expect(r!.evidence[0]).toContain('$250K');
      expectInUnitInterval(r!.score);
    });

    test('two awards still at base (boost needs >= 3)', () => {
      const r = scorePriorAward({ awardCount: 2, totalAmountUsd: 1_200_000 });
      expect(r!.score).toBe(0.8);
      expect(r!.evidence[0]).toContain('2 prior awards');
      expect(r!.evidence[0]).toContain('$1.2M');
    });

    test('award>=3 boost applies and is capped at 0.9', () => {
      const r3 = scorePriorAward({ awardCount: 3, totalAmountUsd: 5_000_000 });
      expect(r3!.score).toBe(0.9);
      const rMany = scorePriorAward({ awardCount: 50, totalAmountUsd: 2_000_000_000 });
      expect(rMany!.score).toBe(PRIOR_AWARD_MAX_SCORE);
      expect(rMany!.score).toBe(0.9);
      expect(rMany!.evidence[0]).toContain('$2B');
      expectInUnitInterval(rMany!.score);
    });

    test('null when no awards', () => {
      expect(scorePriorAward({ awardCount: 0, totalAmountUsd: 0 })).toBeNull();
    });
  });

  describe('scoreFacilityDistrict', () => {
    test('fixed score when districts matched, evidence lists them', () => {
      const r = scoreFacilityDistrict({ matchedDistricts: ['TX-12', 'CA-23'] });
      expect(r).not.toBeNull();
      expect(r!.path).toBe('facility_district');
      expect(r!.score).toBe(FACILITY_DISTRICT_SCORE);
      expect(r!.score).toBe(0.6);
      expect(r!.evidence.join(' ')).toContain('TX-12');
      expectInUnitInterval(r!.score);
    });

    test('null when no districts', () => {
      expect(scoreFacilityDistrict({ matchedDistricts: [] })).toBeNull();
    });
  });

  describe('scoreEcosystem', () => {
    test('fixed score when performers present, evidence lists them', () => {
      const r = scoreEcosystem({ performerNames: ['Acme Aerospace'] });
      expect(r).not.toBeNull();
      expect(r!.path).toBe('ecosystem');
      expect(r!.score).toBe(ECOSYSTEM_SCORE);
      expect(r!.score).toBe(0.5);
      expect(r!.evidence.join(' ')).toContain('Acme Aerospace');
      expectInUnitInterval(r!.score);
    });

    test('null when no performers', () => {
      expect(scoreEcosystem({ performerNames: [] })).toBeNull();
    });
  });
});

describe('client-pe-relevance scoring — combineRelevance', () => {
  test('empty / all-null / all-zero inputs → score 0, no paths', () => {
    expect(combineRelevance([])).toEqual({ score: 0, paths: [] });
    expect(combineRelevance([null, null])).toEqual({ score: 0, paths: [] });
    expect(
      combineRelevance([{ path: 'ecosystem', score: 0, evidence: [] }]),
    ).toEqual({ score: 0, paths: [] });
  });

  test('drops nulls and non-positive paths', () => {
    const facility = scoreFacilityDistrict({ matchedDistricts: ['VA-08'] });
    const r = combineRelevance([null, facility, { path: 'ecosystem', score: 0, evidence: [] }]);
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0]!.path).toBe('facility_district');
    expect(r.score).toBe(0.6);
    expectInUnitInterval(r.score);
  });

  test('single strong path → that score, no diversity bonus', () => {
    const award = scorePriorAward({ awardCount: 1, totalAmountUsd: 100_000 });
    const r = combineRelevance([award]);
    expect(r.score).toBe(0.8);
    expect(r.paths).toHaveLength(1);
    expectInUnitInterval(r.score);
  });

  test('two strong paths → base + one diversity step (0.05)', () => {
    const award = scorePriorAward({ awardCount: 1, totalAmountUsd: 100_000 }); // 0.8
    const facility = scoreFacilityDistrict({ matchedDistricts: ['TX-12'] }); // 0.6
    const r = combineRelevance([award, facility]);
    // base 0.8 + DIVERSITY_STEP (one extra strong path)
    expect(r.score).toBe(round2Helper(0.8 + DIVERSITY_STEP));
    expect(r.score).toBe(0.85);
    expectInUnitInterval(r.score);
  });

  test('five strong paths → diversity bonus capped at MAX_DIVERSITY_BONUS and overall capped at 1', () => {
    const paths: PathResult[] = [
      { path: 'capability_keyword', score: 0.5, evidence: [] },
      { path: 'prior_award', score: 0.5, evidence: [] },
      { path: 'facility_district', score: 0.5, evidence: [] },
      { path: 'ecosystem', score: 0.5, evidence: [] },
      { path: 'capability_pe_direct', score: 0.5, evidence: [] },
    ];
    // 4 extra strong paths * 0.05 = 0.20 = MAX_DIVERSITY_BONUS exactly.
    expect(DIVERSITY_STEP * 4).toBeCloseTo(MAX_DIVERSITY_BONUS, 10);
    const r = combineRelevance(paths);
    // base 0.5 + 0.2 = 0.7
    expect(r.score).toBe(0.7);
    expect(r.paths).toHaveLength(5);
    expectInUnitInterval(r.score);

    // Pushing base high enough that base + capped bonus would exceed 1 → clamps to 1.
    const highBase: PathResult[] = paths.map((p) => ({ ...p, score: 0.9 }));
    const rHigh = combineRelevance(highBase);
    expect(rHigh.score).toBe(1); // 0.9 + 0.2 = 1.1 → capped
    expectInUnitInterval(rHigh.score);
  });

  test('direct PE (1.0) + one weak path stays capped at 1.0', () => {
    const direct = scoreCapabilityPeDirect({ matchedPeNumbers: ['0604256F'] }); // 1.0
    const facility = scoreFacilityDistrict({ matchedDistricts: ['TX-12'] }); // 0.6
    const r = combineRelevance([direct, facility]);
    // base 1.0 + 0.05 diversity → 1.05 → capped at 1
    expect(r.score).toBe(1);
    expect(r.paths[0]!.path).toBe('capability_pe_direct'); // sorted desc
    expectInUnitInterval(r.score);
  });

  test('rounds combined score to 2 decimals', () => {
    const a: PathResult = { path: 'capability_keyword', score: 0.333, evidence: [] };
    const b: PathResult = { path: 'prior_award', score: 0.5, evidence: [] };
    const r = combineRelevance([a, b]);
    // base 0.5 + 0.05 = 0.55 (both >= STRONG_PATH_FLOOR)
    expect(r.score).toBe(0.55);
    // assert it is genuinely 2-dp (no float drift like 0.5500000001)
    expect(r.score).toBe(Number(r.score.toFixed(2)));
    expectInUnitInterval(r.score);
  });

  test('weak sub-floor path does not earn a diversity step', () => {
    const award: PathResult = { path: 'prior_award', score: 0.8, evidence: [] };
    const weak: PathResult = {
      path: 'capability_keyword',
      score: STRONG_PATH_FLOOR - 0.01, // below the strong floor → contributes but no bonus
      evidence: [],
    };
    const r = combineRelevance([award, weak]);
    // only one strong path → no diversity bonus; base stays 0.8
    expect(r.score).toBe(0.8);
    expect(r.paths).toHaveLength(2); // still listed as a contributing path
    expectInUnitInterval(r.score);
  });

  test('paths are sorted by score descending (stable for ties)', () => {
    const lowFirst: PathResult = { path: 'ecosystem', score: 0.5, evidence: [] };
    const tieA: PathResult = { path: 'facility_district', score: 0.6, evidence: ['A'] };
    const tieB: PathResult = { path: 'prior_award', score: 0.6, evidence: ['B'] };
    const r = combineRelevance([lowFirst, tieA, tieB]);
    expect(r.paths.map((p) => p.score)).toEqual([0.6, 0.6, 0.5]);
    // stable: tieA (input first) precedes tieB among equal scores
    expect(r.paths[0]!.evidence).toEqual(['A']);
    expect(r.paths[1]!.evidence).toEqual(['B']);
  });
});

/** local 2-dp rounding mirror for assertions (keeps the spec self-contained). */
function round2Helper(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
