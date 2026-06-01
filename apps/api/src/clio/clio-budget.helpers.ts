/**
 * Pure loop-budget gate for the Clio agentic loop (P2-3).
 *
 * The agentic loop may run several model+tool rounds. This bounds it two ways:
 * a raised hard round cap, and a wall-clock turn budget across all rounds, so a
 * single turn can never run away. The service checks this at the top of each
 * round and wraps up gracefully when a limit is hit. Pure so it unit-tests under
 * `src/**.spec.ts`.
 */

export type LoopStopReason = 'max_rounds' | 'time_budget';

export interface LoopBudgetInput {
  /** 0-based index of the round about to run. */
  round: number;
  /** Hard cap on rounds. */
  maxRounds: number;
  /** Wall-clock ms elapsed since the turn started. */
  elapsedMs: number;
  /** Turn time budget in ms; <= 0 disables the time check. */
  budgetMs: number;
}

/**
 * Returns the reason the loop should stop before running `round`, or null to
 * proceed. The round cap takes precedence over the time budget.
 */
export function loopBudgetExceeded(input: LoopBudgetInput): LoopStopReason | null {
  if (input.round >= input.maxRounds) return 'max_rounds';
  if (input.budgetMs > 0 && input.elapsedMs >= input.budgetMs) return 'time_budget';
  return null;
}
