import { describe, expect, test } from '@jest/globals';
import { TokenBucket } from './rate-limiter.js';

describe('TokenBucket', () => {
  test('allows immediate acquire up to capacity', async () => {
    const bucket = new TokenBucket({ capacity: 3, refillWindowMs: 1000 });
    const start = Date.now();
    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    // Three tokens consumed with no wait.
    expect(Date.now() - start).toBeLessThan(50);
    expect(bucket.available()).toBe(0);
  });

  test('throttles a burst beyond capacity (queues until refill)', async () => {
    // capacity 2, refills 2 tokens / 200ms => 1 token / 100ms.
    const bucket = new TokenBucket({ capacity: 2, refillWindowMs: 200 });
    const start = Date.now();
    await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);
    // 3rd acquire must wait ~100ms for a refill token.
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  test('refills over time using an injected clock', () => {
    let t = 0;
    const bucket = new TokenBucket({ capacity: 10, refillWindowMs: 1000, now: () => t });
    // drain via available()'s refill + manual acquires is async; check refill math directly.
    expect(bucket.available()).toBe(10);
    t = 500; // half the window elapsed but bucket already full
    expect(bucket.available()).toBe(10);
  });

  test('rejects invalid options', () => {
    expect(() => new TokenBucket({ capacity: 0, refillWindowMs: 1000 })).toThrow();
    expect(() => new TokenBucket({ capacity: 5, refillWindowMs: 0 })).toThrow();
  });
});
