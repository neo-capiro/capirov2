/**
 * Token-bucket rate limiter. GovInfo / api.data.gov allows 1000 requests/hour
 * per key; we model that as a bucket of `capacity` tokens that refills at
 * `refillPerMs`. `acquire()` resolves as soon as a token is available, queuing
 * callers in FIFO order when the bucket is empty.
 *
 * Pure + deterministic given a `now()` clock, so it unit-tests with fake timers.
 * No external dependency (intentionally not pulling in bottleneck).
 */
export interface TokenBucketOptions {
  /** Max tokens (burst size). */
  capacity: number;
  /** Refill window in ms over which `capacity` tokens are restored. */
  refillWindowMs: number;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
}

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly now: () => number;
  private tokens: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];
  private draining = false;

  constructor(opts: TokenBucketOptions) {
    if (opts.capacity <= 0) throw new Error('TokenBucket capacity must be > 0');
    if (opts.refillWindowMs <= 0) throw new Error('TokenBucket refillWindowMs must be > 0');
    this.capacity = opts.capacity;
    this.refillPerMs = opts.capacity / opts.refillWindowMs;
    this.now = opts.now ?? Date.now;
    this.tokens = opts.capacity;
    this.lastRefill = this.now();
  }

  /** Current available tokens (after refill). Exposed for tests/telemetry. */
  available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  /**
   * Acquire one token, waiting if necessary. Resolves immediately when a token
   * is available; otherwise queues until the bucket refills enough.
   */
  async acquire(): Promise<void> {
    this.refill();
    if (this.queue.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      void this.drain();
    });
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = t;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        this.refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          const next = this.queue.shift();
          next?.();
          continue;
        }
        // Wait until at least one token will be available.
        const msUntilToken = Math.max(1, Math.ceil((1 - this.tokens) / this.refillPerMs));
        await new Promise<void>((resolve) => setTimeout(resolve, msUntilToken));
      }
    } finally {
      this.draining = false;
    }
  }
}
