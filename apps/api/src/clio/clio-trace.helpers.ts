/**
 * Pure helpers for the Clio execution trace (P1-3, observability).
 *
 * Complements the pre-turn orchestration trace (which context sources were
 * selected) with an EXECUTION trace of the agentic loop: per-round model latency
 * + token usage, the tools each round called and whether they succeeded, and
 * turn-level totals (rounds, tool calls/errors, latency, usage, confidence).
 *
 * The service records per-round data during the loop; these pure functions
 * aggregate it into the object persisted to clio_message.metadata.trace and a
 * compact log line. Kept pure (no I/O) so they unit-test under `src/**.spec.ts`.
 */

export interface ClioTraceUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface ClioToolTrace {
  name: string;
  ok: boolean;
}

export interface ClioRoundTrace {
  round: number;
  durationMs: number;
  usage: ClioTraceUsage;
  stopReason: string | null;
  tools: ClioToolTrace[];
}

export interface ClioTurnTrace {
  intent: string;
  skill: string | null;
  roundCount: number;
  toolCallCount: number;
  toolErrorCount: number;
  totalDurationMs: number;
  totalUsage: ClioTraceUsage;
  /** From the P0-6 verifier; null when no deliverable was verified. */
  lowConfidence: boolean | null;
  rounds: ClioRoundTrace[];
}

export interface SummarizeTurnTraceInput {
  intent: string;
  skill: string | null;
  rounds: ClioRoundTrace[];
  totalUsage: ClioTraceUsage;
  totalDurationMs: number;
  lowConfidence: boolean | null;
}

/** Aggregate per-round trace data into the persisted turn trace. */
export function summarizeTurnTrace(input: SummarizeTurnTraceInput): ClioTurnTrace {
  let toolCallCount = 0;
  let toolErrorCount = 0;
  for (const r of input.rounds) {
    toolCallCount += r.tools.length;
    for (const t of r.tools) if (!t.ok) toolErrorCount += 1;
  }
  return {
    intent: input.intent,
    skill: input.skill,
    roundCount: input.rounds.length,
    toolCallCount,
    toolErrorCount,
    totalDurationMs: input.totalDurationMs,
    totalUsage: input.totalUsage,
    lowConfidence: input.lowConfidence,
    rounds: input.rounds,
  };
}

/** Compact one-line summary for logs. */
export function traceLogLine(t: ClioTurnTrace): string {
  const parts = [
    `intent=${t.intent}`,
    `skill=${t.skill ?? '-'}`,
    `rounds=${t.roundCount}`,
    `tools=${t.toolCallCount}`,
    `toolErrors=${t.toolErrorCount}`,
    `ms=${t.totalDurationMs}`,
    `in=${t.totalUsage.inputTokens}`,
    `out=${t.totalUsage.outputTokens}`,
    `cacheRead=${t.totalUsage.cacheReadInputTokens}`,
  ];
  if (t.lowConfidence != null) parts.push(`lowConfidence=${t.lowConfidence}`);
  return `Clio trace ${parts.join(' ')}`;
}
