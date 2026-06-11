import { describe, expect, it } from '@jest/globals';

/**
 * Behavioral guard for the bounded-concurrency map that powers parallel
 * outreach draft generation. mapWithConcurrency is module-private in
 * engagement.service.ts, so we re-declare an identical copy here and pin the
 * three properties the batch generator relies on:
 *   1. results are returned in INPUT order regardless of completion order;
 *   2. at most `concurrency` workers run at once;
 *   3. a worker that handles its own errors (returns a value) never rejects
 *      the whole batch — every input still yields an entry.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let nextIndex = 0;

  async function runner(): Promise<void> {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await worker(items[current] as T, current);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runner()));
  return results;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapWithConcurrency (outreach batch generation)', () => {
  it('preserves input order even when later items finish first', async () => {
    const input = [50, 40, 30, 20, 10]; // earlier items take LONGER
    const out = await mapWithConcurrency(input, 5, async (ms, i) => {
      await delay(ms);
      return `r${i}`;
    });
    expect(out).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });

  it('maps each recipient to the right result by index', async () => {
    const recipients = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const out = await mapWithConcurrency(recipients, 3, async (name, i) => {
      await delay((7 - i) * 5); // reverse-ordered completion
      return `${name.toUpperCase()}#${i}`;
    });
    expect(out).toEqual(['A#0', 'B#1', 'C#2', 'D#3', 'E#4', 'F#5', 'G#6']);
  });

  it('never exceeds the concurrency cap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapWithConcurrency(items, 4, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(5);
      inFlight -= 1;
      return n;
    });
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1); // proves it actually parallelized
  });

  it('isolates per-item failures handled inside the worker (blank draft, no batch reject)', async () => {
    // Mirrors the generate worker: a thrown AI error is caught and yields a
    // blank { subject:'', body:'' } entry rather than failing the batch.
    const recipients = ['ok1', 'BOOM', 'ok2'];
    const out = await mapWithConcurrency(recipients, 2, async (name, i) => {
      try {
        if (name === 'BOOM') throw new Error('AI provider 500');
        return { recipientId: String(i), subject: `S${i}`, body: `B${i}` };
      } catch {
        return { recipientId: String(i), subject: '', body: '' };
      }
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ recipientId: '0', subject: 'S0', body: 'B0' });
    expect(out[1]).toEqual({ recipientId: '1', subject: '', body: '' });
    expect(out[2]).toEqual({ recipientId: '2', subject: 'S2', body: 'B2' });
  });

  it('handles an empty recipient list without hanging', async () => {
    const out = await mapWithConcurrency([], 4, async () => 'x');
    expect(out).toEqual([]);
  });

  it('handles concurrency larger than the item count', async () => {
    const out = await mapWithConcurrency([1, 2], 10, async (n) => n * 2);
    expect(out).toEqual([2, 4]);
  });
});
