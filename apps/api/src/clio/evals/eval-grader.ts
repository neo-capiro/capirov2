/**
 * Pure grading logic for the Clio eval harness (P1-1).
 *
 * Deterministic checks (include / exclude / cite / unsupported-ratio) so they
 * unit-test under the repo's `src/**.spec.ts` matcher with NO network. The live
 * runner supplies `unsupportedRatio` from the verifier; everything else is
 * computed from the answer text alone.
 */
import type { ClioEvalFixture, ClioEvalGrade, ClioEvalSummary } from './eval.types.js';

const CITATION_RE = /\[(\d+)\]/g;

/** Distinct citation marker numbers ([n]) in order of first appearance. */
export function citationMarkers(text: string): number[] {
  const out: number[] = [];
  if (typeof text !== 'string') return out;
  for (const m of text.matchAll(CITATION_RE)) {
    const g = m[1];
    if (g == null) continue;
    const n = Number(g);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Grounded = verified AND unsupported ratio within the (effective) threshold. */
export function isGrounded(grade: ClioEvalGrade, threshold: number): boolean {
  return grade.unsupportedRatio != null && grade.unsupportedRatio <= threshold;
}

/**
 * Grade one answer against a fixture. `unsupportedRatio` comes from the verifier
 * (null when the answer was not verified — e.g. no sources, or verifier off);
 * the ratio check is only applied when both a max and a measured ratio exist.
 */
export function gradeAnswer(
  fixture: ClioEvalFixture,
  answer: string,
  unsupportedRatio: number | null = null,
): ClioEvalGrade {
  const failures: string[] = [];
  const text = typeof answer === 'string' ? answer : '';
  const haystack = text.toLowerCase();

  for (const needle of fixture.expect.mustInclude) {
    if (!haystack.includes(needle.toLowerCase())) {
      failures.push(`missing required text: "${needle}"`);
    }
  }
  for (const needle of fixture.expect.mustNotInclude) {
    if (haystack.includes(needle.toLowerCase())) {
      failures.push(`contains forbidden text: "${needle}"`);
    }
  }

  const markers = citationMarkers(text);
  if (fixture.expect.mustCite && markers.length === 0) {
    failures.push('expected at least one [n] citation but found none');
  }

  const maxUnsup = fixture.expect.maxUnsupportedRatio;
  if (maxUnsup != null && unsupportedRatio != null && unsupportedRatio > maxUnsup) {
    failures.push(
      `unsupported-claim ratio ${(unsupportedRatio * 100).toFixed(0)}% exceeds max ${(maxUnsup * 100).toFixed(0)}%`,
    );
  }

  return {
    id: fixture.id,
    skill: fixture.skill,
    pass: failures.length === 0,
    failures,
    citationCount: markers.length,
    unsupportedRatio,
  };
}

/** Aggregate grades into overall + per-skill stats. `threshold` defines grounded-rate. */
export function summarizeGrades(grades: ClioEvalGrade[], threshold = 0.2): ClioEvalSummary {
  const total = grades.length;
  const passed = grades.filter((g) => g.pass).length;
  const verified = grades.filter((g) => g.unsupportedRatio != null);
  const grounded = verified.filter((g) => isGrounded(g, threshold)).length;

  const bySkill: ClioEvalSummary['bySkill'] = {};
  for (const g of grades) {
    const stat = bySkill[g.skill] ?? { total: 0, passed: 0 };
    stat.total += 1;
    if (g.pass) stat.passed += 1;
    bySkill[g.skill] = stat;
  }

  return {
    total,
    passed,
    failed: total - passed,
    passRate: total === 0 ? 1 : passed / total,
    groundedRate: verified.length === 0 ? 1 : grounded / verified.length,
    verifiedCount: verified.length,
    bySkill,
  };
}
