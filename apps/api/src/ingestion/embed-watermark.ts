/**
 * Pure helpers for the embed-backfill autonomous-incremental watermark.
 *
 * Extracted so the watermark logic is unit-testable without booting the
 * standalone tsx script (which parses argv + connects to Postgres/Bedrock at
 * module load). Phase 0 will fold the SyncRun read/write into the shared
 * `runWithSyncRun` helper; until then this isolates the one piece with real
 * logic risk: turning a SyncRun `startedAt` into the `--since` window.
 */

/** SyncRun source name for an embedding sub-source (e.g. 'embed:lda'). */
export function embedSyncSource(kind: string): string {
  return `embed:${kind}`;
}

/**
 * Resolve the effective `--since` (YYYY-MM-DD) for an incremental embed run.
 * Explicit flag always wins; otherwise fall back to the last successful run's
 * start time; otherwise undefined (full backfill).
 */
export function resolveSinceWindow(
  explicitSince: string | undefined,
  lastSuccessfulStartedAt: Date | null,
): string | undefined {
  if (explicitSince) return explicitSince;
  if (lastSuccessfulStartedAt) {
    return lastSuccessfulStartedAt.toISOString().slice(0, 10);
  }
  return undefined;
}

export interface RunCounts {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

/** Final SyncRun status from a run's error count. */
export function statusFromCounts(counts: RunCounts): 'success' | 'success_with_errors' {
  return counts.errors > 0 ? 'success_with_errors' : 'success';
}
