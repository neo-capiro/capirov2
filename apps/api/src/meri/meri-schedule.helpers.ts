/**
 * Pure, dependency-free helpers for Meri self-scheduled tasks (W3).
 *
 * No I/O / Prisma here so it unit-tests under `src/**.spec.ts`. The tool handler
 * (meri-tools.service.ts) and the runner (scripts/run-clio-scheduled-tasks.ts)
 * consume these.
 *
 * SAFETY MODEL (v1): unattended scheduled runs may only call READ-ONLY research
 * tools. Side-effecting tools (email send/reply, note/memo/doc writes, memory
 * writes) are NOT permitted in a schedule without an explicit, separately
 * approved opt-in — so a self-scheduling agent can never silently email on a
 * user's behalf. `isAllowListSafe` enforces that.
 */

/** Minimum cadence between runs — guards against runaway scheduling/cost. */
export const MIN_INTERVAL_MINUTES = 60;
/** Max scheduled tasks per tenant. */
export const MAX_TASKS_PER_TENANT = 25;

/**
 * Read-only research tools a scheduled task may call by default. Kept in sync
 * with the read-only tools in meri-tools.service.ts; deliberately EXCLUDES every
 * side-effecting tool (send_email, reply_email, save_note, save_memory,
 * draft_policy_memo, create_meeting_brief, create_word/excel/powerpoint).
 */
export const DEFAULT_SCHEDULED_TOOL_ALLOWLIST: readonly string[] = [
  'get_client_context',
  'search_research_sources',
  'query_intelligence',
  'search_congress_bills',
  'search_lda_filings',
  'search_sec_filings',
  'search_fara_registrations',
  'search_federal_grants',
  'search_federal_awards',
  'search_gao_reports',
  'search_state_bills',
  'search_intel_articles',
  'search_committee_hearings',
  'search_crs_reports',
  'query_economic_data',
  'search_program_elements',
  'get_program_element',
  'get_pe_budget_timeline',
  'get_pe_contractors',
  'get_pe_bills',
  'search_acquisition_personnel',
  'get_acquisition_person',
  // Firm operational data reads (tool-coverage expansion) — read-only, so
  // unattended scheduled research may use them.
  'query_workflows',
  'query_tasks',
  'query_strategies',
  'query_action_items',
  'search_tracked_bills',
  'query_regulatory_dockets',
  'search_sam_opportunities',
  'query_debriefs',
  'query_outreach',
] as const;

/**
 * Side-effecting tool names that are FORBIDDEN in an unattended schedule (v1).
 * Mirrors SIDE_EFFECTING_TOOLS in meri-tools.service.ts.
 */
export const FORBIDDEN_SCHEDULED_TOOLS: ReadonlySet<string> = new Set<string>([
  'send_email',
  'reply_email',
  'save_note',
  'save_memory',
  'draft_policy_memo',
  'create_meeting_brief',
  'create_word',
  'create_excel',
  'create_powerpoint',
  'scrape_web_page',
  'create_task',
  'update_task',
  'update_workflow_field',
]);

export interface ScheduleValidationResult {
  ok: boolean;
  error?: string;
  intervalMinutes?: number;
  allowList?: string[];
}

/** Clamp + validate a requested cadence (minutes). */
export function normalizeInterval(requested: unknown): number | null {
  const n = typeof requested === 'number' ? requested : Number(requested);
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  if (floored < MIN_INTERVAL_MINUTES) return null;
  // Cap at 30 days so nextRunAt math stays sane.
  return Math.min(floored, 60 * 24 * 30);
}

/**
 * Validate a requested tool allow-list for a scheduled task. Empty / missing =>
 * the read-only default. Any FORBIDDEN (side-effecting) tool => rejected, so v1
 * schedules can never run an unattended side effect.
 */
export function validateAllowList(requested: unknown): ScheduleValidationResult {
  if (requested == null || (Array.isArray(requested) && requested.length === 0)) {
    return { ok: true, allowList: [...DEFAULT_SCHEDULED_TOOL_ALLOWLIST] };
  }
  if (!Array.isArray(requested)) {
    return { ok: false, error: 'toolAllowList must be an array of tool names' };
  }
  const names = requested.filter((t): t is string => typeof t === 'string');
  const forbidden = names.filter((t) => FORBIDDEN_SCHEDULED_TOOLS.has(t));
  if (forbidden.length > 0) {
    return {
      ok: false,
      error: `Scheduled tasks cannot use side-effecting tools: ${forbidden.join(', ')}. v1 schedules are read-only.`,
    };
  }
  // Only keep tools that are in the known read-only default set.
  const allowed = names.filter((t) => DEFAULT_SCHEDULED_TOOL_ALLOWLIST.includes(t));
  if (allowed.length === 0) {
    return { ok: true, allowList: [...DEFAULT_SCHEDULED_TOOL_ALLOWLIST] };
  }
  return { ok: true, allowList: allowed };
}

/** True when every tool in the list is read-only-safe for unattended runs. */
export function isAllowListSafe(allowList: readonly string[]): boolean {
  return allowList.every((t) => !FORBIDDEN_SCHEDULED_TOOLS.has(t));
}

/** Compute the next run timestamp from a base time + interval. */
export function computeNextRunAt(from: Date, intervalMinutes: number): Date {
  return new Date(from.getTime() + intervalMinutes * 60_000);
}

/** Whether a task is due at `now` (enabled + nextRunAt <= now). */
export function isDue(
  task: { enabled: boolean; nextRunAt: Date },
  now: Date,
): boolean {
  return task.enabled && task.nextRunAt.getTime() <= now.getTime();
}

/** Full validation for a new schedule request. */
export function validateScheduleRequest(input: {
  name?: unknown;
  prompt?: unknown;
  intervalMinutes?: unknown;
  toolAllowList?: unknown;
  existingTaskCount: number;
}): ScheduleValidationResult {
  if (input.existingTaskCount >= MAX_TASKS_PER_TENANT) {
    return { ok: false, error: `Tenant has reached the maximum of ${MAX_TASKS_PER_TENANT} scheduled tasks.` };
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) return { ok: false, error: 'A task name is required.' };
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) return { ok: false, error: 'A task prompt/instruction is required.' };
  const interval = normalizeInterval(input.intervalMinutes);
  if (interval == null) {
    return { ok: false, error: `intervalMinutes must be a number >= ${MIN_INTERVAL_MINUTES}.` };
  }
  const allow = validateAllowList(input.toolAllowList);
  if (!allow.ok) return allow;
  return { ok: true, intervalMinutes: interval, allowList: allow.allowList };
}
