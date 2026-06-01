/**
 * Shared SyncRun lifecycle + incremental watermark for all ingestion jobs.
 *
 * Production Ingestion plan, Phase 0. Every sync/extract/emit job wraps its body
 * in `runWithSyncRun(prisma, source, fn)`:
 *   1. reads the last SUCCESSFUL run's startedAt as the incremental `since`
 *      (so the job only pulls NEW data — "only ingest new data"),
 *   2. opens a SyncRun row (status='running'),
 *   3. runs `fn({ since, prisma })` which returns row counts,
 *   4. closes the SyncRun row (success / success_with_errors / error) with counts.
 *
 * This standardizes what only 6 scripts did ad-hoc, and is the single source of
 * truth the ingestion dashboard + alarms read.
 */
import type { PrismaClient } from '@prisma/client';
import { statusFromCounts, type RunCounts } from './embed-watermark.js';

export type { RunCounts } from './embed-watermark.js';

/** Minimal slice of PrismaClient we touch — keeps this unit-testable with a mock. */
export interface SyncRunCapablePrisma {
  syncRun: {
    findFirst(args: unknown): Promise<{ startedAt: Date } | null>;
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
}

export interface SyncRunContext {
  /** Last successful run's startedAt, or null if this source has never succeeded. */
  since: Date | null;
  /** YYYY-MM-DD form of `since` for scripts that pass a date-string `--since`. */
  sinceDate: string | null;
}

export interface RunWithSyncRunOptions {
  /**
   * Explicit override for the incremental window (e.g. a `--since` CLI flag or a
   * `--backfill` floor). When provided it wins over the watermark, exactly like
   * the existing scripts. Pass a Date or YYYY-MM-DD string.
   */
  overrideSince?: Date | string | null;
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

function toDateString(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * Emit a single structured metric line to stdout. A CloudWatch Logs metric
 * filter on the sync-jobs log group turns these into the `Capiro/Ingestion`
 * metrics the alarms watch — zero runtime AWS dependency, matches the existing
 * ProgramElementSync pattern. Best-effort: never throws.
 */
function emitMetricLine(source: string, counts: RunCounts, durationSeconds: number): void {
  try {
    console.log(
      `INGESTION_METRIC ${JSON.stringify({
        source,
        rows_inserted: counts.inserted,
        rows_updated: counts.updated,
        error_count: counts.errors,
        duration_seconds: Math.round(durationSeconds),
      })}`,
    );
  } catch {
    /* never break ingestion on a logging failure */
  }
}

/** Most recent successful run's start time for this source, or null. */
export async function lastSuccessfulWatermark(
  prisma: SyncRunCapablePrisma,
  source: string,
): Promise<Date | null> {
  const run = await prisma.syncRun.findFirst({
    where: { source, status: 'success' },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true },
  });
  return run?.startedAt ?? null;
}

/**
 * Wrap one ingestion job in a SyncRun row with incremental-watermark resolution.
 * `fn` receives the resolved `since` window and must return row counts.
 * On throw: records status='error' + message, then rethrows (process exits
 * non-zero so the scheduler/alarm sees the failure).
 */
export async function runWithSyncRun(
  prisma: SyncRunCapablePrisma,
  source: string,
  fn: (ctx: SyncRunContext) => Promise<RunCounts>,
  options: RunWithSyncRunOptions = {},
): Promise<RunCounts> {
  const override = toDate(options.overrideSince);
  const since = override ?? (await lastSuccessfulWatermark(prisma, source));
  const ctx: SyncRunContext = { since, sinceDate: toDateString(since) };

  const run = await prisma.syncRun.create({
    data: { source, startedAt: new Date(), status: 'running' },
    select: { id: true },
  });
  const t0 = Date.now();

  try {
    const counts = await fn(ctx);
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        rowsInserted: counts.inserted,
        rowsUpdated: counts.updated,
        errorCount: counts.errors,
        status: statusFromCounts(counts),
      },
    });
    await emitMetricLine(source, counts, (Date.now() - t0) / 1000);
    return counts;
  } catch (e) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: 'error',
        errorCount: 1,
        errorMessage: (e as Error).message.slice(0, 1000),
      },
    });
    emitMetricLine(source, { inserted: 0, updated: 0, skipped: 0, errors: 1 }, (Date.now() - t0) / 1000);
    throw e;
  }
}

/** Convenience zero-counts starter for accumulating in a job body. */
export function emptyCounts(): RunCounts {
  return { inserted: 0, updated: 0, skipped: 0, errors: 0 };
}

// Re-export so callers import one module.
export type PrismaLike = PrismaClient & SyncRunCapablePrisma;
