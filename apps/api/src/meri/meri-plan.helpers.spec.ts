import { describe, expect, test } from '@jest/globals';
import { buildPlanSteps, type PlanTraceStep } from './meri-plan.helpers.js';

describe('buildPlanSteps', () => {
  test('maps selected steps to friendly labels in order and appends a synthesis step', () => {
    const trace: PlanTraceStep[] = [
      { tool: 'client_profile', action: 'selected', reason: 'client-linked' },
      { tool: 'clio_memory', action: 'skipped', reason: 'no match' },
      { tool: 'query_intelligence', action: 'selected', reason: 'intent needs it' },
    ];
    expect(buildPlanSteps(trace, 'general_question')).toEqual([
      'Review the client profile',
      'Check federal intelligence',
      'Synthesize an answer with citations',
    ]);
  });

  test('dedupes by tool (first occurrence wins)', () => {
    const trace: PlanTraceStep[] = [
      { tool: 'search_research_sources', action: 'selected' },
      { tool: 'search_research_sources', action: 'selected' },
    ];
    const steps = buildPlanSteps(trace, 'general_question');
    expect(steps.filter((s) => s === 'Search your workspace research')).toHaveLength(1);
  });

  test('closing step is keyed to intent', () => {
    expect(buildPlanSteps([], 'generate_briefing').at(-1)).toBe(
      'Assemble the briefing with citations',
    );
    expect(buildPlanSteps([], 'generate_draft').at(-1)).toBe('Draft the document');
    expect(buildPlanSteps([], 'navigate').at(-1)).toBe('Take you to the right place');
  });

  test('falls back to a humanized label for unknown tools', () => {
    expect(buildPlanSteps([{ tool: 'some_new_tool', action: 'selected' }], 'x')).toContain(
      'Use some new tool',
    );
  });
});
