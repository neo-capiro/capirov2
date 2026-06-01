/**
 * Pure orchestration helper for executing one agentic round's tool calls
 * concurrently while preserving result order (P0-2).
 *
 * Read-only tools run in parallel; tools flagged concurrency-unsafe (the
 * side-effecting writes: send_email, reply_email, save_note, draft_policy_memo,
 * create_meeting_brief) run in a serial chain so two mutations never race within
 * a round. Each tool is bounded by a per-tool timeout; a timeout or a throw is
 * captured as a failed outcome rather than aborting the whole turn — the model
 * then sees an error tool_result and can proceed honestly.
 *
 * The actual tool I/O is injected as `run`, so this file stays pure and is
 * unit-tested with fake async functions under the repo's `src/**.spec.ts`
 * matcher. NOTE: a timed-out tool's underlying promise is not hard-aborted (the
 * work may still complete in the background); we simply stop awaiting it. That
 * is acceptable because every tool call is tenant-scoped and idempotent at the
 * persistence layer.
 */

export interface ConcurrentToolItem {
  /** Original position in the round's tool list; results are returned in this order. */
  index: number;
  /** False for side-effecting tools, which are serialized relative to each other. */
  concurrencySafe: boolean;
}

export interface ToolRunOutcome<R> {
  index: number;
  ok: boolean;
  result?: R;
  error?: string;
  timedOut: boolean;
  latencyMs: number;
}

export class ToolTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`Tool timed out after ${ms}ms`);
    this.name = 'ToolTimeoutError';
  }
}

/**
 * Resolve `promise`, rejecting with `ToolTimeoutError` if it does not settle
 * within `ms`. A non-positive / non-finite `ms` disables the timeout.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ToolTimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Execute `items` via `run`, parallelizing concurrency-safe items and
 * serializing unsafe ones, and return outcomes in original `index` order.
 * Never rejects: each item's failure is captured in its `ToolRunOutcome`.
 */
export async function runToolsConcurrently<T extends ConcurrentToolItem, R>(
  items: T[],
  run: (item: T) => Promise<R>,
  opts: { timeoutMs: number },
): Promise<Array<ToolRunOutcome<R>>> {
  const outcomes = new Array<ToolRunOutcome<R>>(items.length);

  const runOne = async (item: T): Promise<void> => {
    const start = Date.now();
    try {
      const result = await withTimeout(run(item), opts.timeoutMs);
      outcomes[item.index] = {
        index: item.index,
        ok: true,
        result,
        timedOut: false,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      outcomes[item.index] = {
        index: item.index,
        ok: false,
        error: err instanceof Error ? err.message : 'Tool execution failed',
        timedOut: err instanceof ToolTimeoutError,
        latencyMs: Date.now() - start,
      };
    }
  };

  const safeRuns = items.filter((i) => i.concurrencySafe).map((item) => runOne(item));
  const unsafeChain = (async () => {
    for (const item of items.filter((i) => !i.concurrencySafe)) {
      await runOne(item);
    }
  })();

  await Promise.all([...safeRuns, unsafeChain]);
  return outcomes;
}
