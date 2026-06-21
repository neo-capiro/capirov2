/**
 * Pure helper for the streamed plan (P2-1).
 *
 * Turns the pre-turn orchestration trace (which context sources were selected)
 * into a short, human-readable plan the UI shows up front — "here's what I'll do"
 * before tokens stream. Kept pure (no I/O) so it unit-tests under `src/**.spec.ts`;
 * the service emits the result as a `plan` SSE event right after `start`.
 */

export interface PlanTraceStep {
  tool: string;
  action: 'selected' | 'skipped' | string;
  reason?: string;
}

const STEP_LABELS: Record<string, string> = {
  client_profile: 'Review the client profile',
  clio_memory: 'Recall what I know about this',
  search_research_sources: 'Search your workspace research',
  query_intelligence: 'Check federal intelligence',
  search_public_web: 'Search the public web',
  get_client_context: 'Load detailed client context',
};

function humanizeTool(tool: string): string {
  const t = tool.replace(/_/g, ' ').trim();
  return t ? `Use ${t}` : 'Gather context';
}

function finalStep(intent: string): string {
  if (intent === 'generate_briefing') return 'Assemble the briefing with citations';
  if (intent === 'generate_draft') return 'Draft the document';
  if (intent === 'navigate') return 'Take you to the right place';
  return 'Synthesize an answer with citations';
}

/**
 * Build the ordered plan steps from the orchestration trace + classified intent.
 * Only `selected` context steps are included (deduped by tool, first wins), then
 * a closing synthesis/deliverable step keyed to the intent.
 */
export function buildPlanSteps(trace: PlanTraceStep[], intent: string): string[] {
  const seen = new Set<string>();
  const steps: string[] = [];
  for (const s of trace) {
    if (s.action !== 'selected' || seen.has(s.tool)) continue;
    seen.add(s.tool);
    steps.push(STEP_LABELS[s.tool] ?? humanizeTool(s.tool));
  }
  steps.push(finalStep(intent));
  return steps;
}
