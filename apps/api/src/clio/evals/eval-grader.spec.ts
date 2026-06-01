import { describe, expect, test } from '@jest/globals';
import { citationMarkers, gradeAnswer, isGrounded, summarizeGrades } from './eval-grader.js';
import type { ClioEvalExpect, ClioEvalFixture, ClioEvalGrade } from './eval.types.js';

function fixture(
  expect: Partial<ClioEvalExpect>,
  over: Partial<ClioEvalFixture> = {},
): ClioEvalFixture {
  return {
    id: over.id ?? 'fx-1',
    skill: over.skill ?? 'general',
    question: over.question ?? 'q?',
    sources: over.sources ?? [],
    expect: { mustInclude: [], mustNotInclude: [], mustCite: false, ...expect },
  };
}

describe('citationMarkers', () => {
  test('extracts distinct [n] markers in order', () => {
    expect(citationMarkers('per [1] and [3], also [1] again')).toEqual([1, 3]);
  });
  test('ignores non-markers and zero', () => {
    expect(citationMarkers('no cites here')).toEqual([]);
    expect(citationMarkers('[0] is not valid, [2] is')).toEqual([2]);
  });
});

describe('gradeAnswer — deterministic checks', () => {
  test('passes when all mustInclude present (case-insensitive)', () => {
    const g = gradeAnswer(
      fixture({ mustInclude: ['NDAA', 'markup'] }),
      'The ndaa MARKUP is scheduled.',
    );
    expect(g.pass).toBe(true);
    expect(g.failures).toEqual([]);
  });

  test('fails on missing required text', () => {
    const g = gradeAnswer(fixture({ mustInclude: ['appropriations'] }), 'unrelated answer');
    expect(g.pass).toBe(false);
    expect(g.failures[0]).toContain('appropriations');
  });

  test('fails on forbidden text', () => {
    const g = gradeAnswer(
      fixture({ mustNotInclude: ['guaranteed'] }),
      'This is guaranteed to pass.',
    );
    expect(g.pass).toBe(false);
    expect(g.failures[0]).toContain('forbidden');
  });

  test('mustCite requires at least one [n]', () => {
    expect(gradeAnswer(fixture({ mustCite: true }), 'no citation').pass).toBe(false);
    const ok = gradeAnswer(fixture({ mustCite: true }), 'supported by the bill text [1].');
    expect(ok.pass).toBe(true);
    expect(ok.citationCount).toBe(1);
  });

  test('unsupported-ratio only enforced when both max and measured ratio exist', () => {
    const fx = fixture({ maxUnsupportedRatio: 0.2 });
    expect(gradeAnswer(fx, 'answer', null).pass).toBe(true); // not verified -> not enforced
    expect(gradeAnswer(fx, 'answer', 0.1).pass).toBe(true);
    const bad = gradeAnswer(fx, 'answer', 0.5);
    expect(bad.pass).toBe(false);
    expect(bad.failures[0]).toContain('exceeds max');
  });
});

describe('isGrounded', () => {
  const base: ClioEvalGrade = {
    id: 'x',
    skill: 'research',
    pass: true,
    failures: [],
    citationCount: 1,
    unsupportedRatio: null,
  };
  test('null ratio is never grounded', () => {
    expect(isGrounded({ ...base, unsupportedRatio: null }, 0.2)).toBe(false);
  });
  test('within threshold is grounded', () => {
    expect(isGrounded({ ...base, unsupportedRatio: 0.2 }, 0.2)).toBe(true);
    expect(isGrounded({ ...base, unsupportedRatio: 0.5 }, 0.2)).toBe(false);
  });
});

describe('summarizeGrades', () => {
  test('aggregates pass-rate, grounded-rate, and per-skill stats', () => {
    const grades: ClioEvalGrade[] = [
      {
        id: 'a',
        skill: 'briefing',
        pass: true,
        failures: [],
        citationCount: 2,
        unsupportedRatio: 0.0,
      },
      {
        id: 'b',
        skill: 'briefing',
        pass: false,
        failures: ['x'],
        citationCount: 0,
        unsupportedRatio: 0.5,
      },
      {
        id: 'c',
        skill: 'general',
        pass: true,
        failures: [],
        citationCount: 0,
        unsupportedRatio: null,
      },
    ];
    const s = summarizeGrades(grades, 0.2);
    expect(s.total).toBe(3);
    expect(s.passed).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.passRate).toBeCloseTo(2 / 3);
    // verified = a (0.0) and b (0.5); grounded = a only => 1/2
    expect(s.verifiedCount).toBe(2);
    expect(s.groundedRate).toBeCloseTo(0.5);
    expect(s.bySkill['briefing']).toEqual({ total: 2, passed: 1 });
    expect(s.bySkill['general']).toEqual({ total: 1, passed: 1 });
  });

  test('empty set is vacuously healthy', () => {
    const s = summarizeGrades([], 0.2);
    expect(s.passRate).toBe(1);
    expect(s.groundedRate).toBe(1);
  });
});
