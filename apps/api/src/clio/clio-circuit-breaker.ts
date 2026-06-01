/**
 * Per-tool circuit breaker for the Clio agentic loop (P2-2).
 *
 * When a tool fails repeatedly we stop calling it for a cooldown window and let
 * the turn proceed honestly without it (the model sees a "temporarily
 * unavailable" tool_result), rather than burning rounds + latency retrying a
 * dead dependency. Keys are caller-chosen; the service keys by `${tenantId}:
 * ${tool}` so one tenant's failures never trip another tenant's breaker
 * (tenant isolation).
 *
 * Pure + clock-injectable so it unit-tests under `src/**.spec.ts` with no timers.
 */

export class CircuitOpenError extends Error {
  constructor(public readonly tool: string) {
    super(
      `Temporarily unavailable: "${tool}" has failed repeatedly and is paused; proceeding without it.`,
    );
    this.name = 'CircuitOpenError';
  }
}

export interface ToolCircuitBreakerOptions {
  /** Consecutive failures that trip the breaker open. */
  threshold: number;
  /** How long the breaker stays open before a half-open retry, in ms. */
  cooldownMs: number;
  /** Injectable clock (defaults to Date.now) for deterministic tests. */
  now?: () => number;
}

interface BreakerEntry {
  failures: number;
  openUntil: number;
}

export class ToolCircuitBreaker {
  private readonly entries = new Map<string, BreakerEntry>();
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(opts: ToolCircuitBreakerOptions) {
    this.threshold = Math.max(1, Math.floor(opts.threshold));
    this.cooldownMs = Math.max(0, opts.cooldownMs);
    this.now = opts.now ?? (() => Date.now());
  }

  /** True while the breaker for `key` is open (within its cooldown window). */
  isOpen(key: string): boolean {
    const e = this.entries.get(key);
    return e != null && e.openUntil > this.now();
  }

  /** A successful call closes the breaker and clears the failure streak. */
  recordSuccess(key: string): void {
    this.entries.set(key, { failures: 0, openUntil: 0 });
  }

  /** A failed call increments the streak and opens the breaker at the threshold. */
  recordFailure(key: string): void {
    const e = this.entries.get(key) ?? { failures: 0, openUntil: 0 };
    e.failures += 1;
    if (e.failures >= this.threshold) e.openUntil = this.now() + this.cooldownMs;
    this.entries.set(key, e);
  }
}
