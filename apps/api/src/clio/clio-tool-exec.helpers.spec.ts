import {
  runToolsConcurrently,
  ToolTimeoutError,
  withTimeout,
  type ConcurrentToolItem,
} from './clio-tool-exec.helpers.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('rejects with ToolTimeoutError when the promise is too slow', async () => {
    await expect(
      withTimeout(
        sleep(200).then(() => 'late'),
        30,
      ),
    ).rejects.toBeInstanceOf(ToolTimeoutError);
  });

  it('disables the timeout for non-positive ms', async () => {
    await expect(
      withTimeout(
        sleep(20).then(() => 'v'),
        0,
      ),
    ).resolves.toBe('v');
  });
});

describe('runToolsConcurrently', () => {
  it('runs concurrency-safe tools in parallel (≈max latency, not sum)', async () => {
    const items: ConcurrentToolItem[] = [
      { index: 0, concurrencySafe: true },
      { index: 1, concurrencySafe: true },
      { index: 2, concurrencySafe: true },
    ];
    const start = Date.now();
    const outcomes = await runToolsConcurrently(
      items,
      async () => {
        await sleep(120);
        return 'done';
      },
      { timeoutMs: 5000 },
    );
    const elapsed = Date.now() - start;
    expect(outcomes.every((o) => o.ok)).toBe(true);
    // 3 x 120ms in parallel should finish well under the 360ms serial sum.
    expect(elapsed).toBeLessThan(300);
  });

  it('preserves original order regardless of completion order', async () => {
    const items: ConcurrentToolItem[] = [
      { index: 0, concurrencySafe: true },
      { index: 1, concurrencySafe: true },
      { index: 2, concurrencySafe: true },
    ];
    const delays = [100, 10, 50];
    const outcomes = await runToolsConcurrently(
      items,
      async (item) => {
        await sleep(delays[item.index]!);
        return `tool-${item.index}`;
      },
      { timeoutMs: 5000 },
    );
    expect(outcomes.map((o) => o.result)).toEqual(['tool-0', 'tool-1', 'tool-2']);
    expect(outcomes.map((o) => o.index)).toEqual([0, 1, 2]);
  });

  it('parallelizes safe tools but serializes unsafe (write) tools', async () => {
    let activeSafe = 0;
    let activeUnsafe = 0;
    let maxSafe = 0;
    let maxUnsafe = 0;
    const items: ConcurrentToolItem[] = [
      { index: 0, concurrencySafe: true },
      { index: 1, concurrencySafe: true },
      { index: 2, concurrencySafe: false },
      { index: 3, concurrencySafe: false },
    ];
    await runToolsConcurrently(
      items,
      async (item) => {
        if (item.concurrencySafe) {
          activeSafe += 1;
          maxSafe = Math.max(maxSafe, activeSafe);
        } else {
          activeUnsafe += 1;
          maxUnsafe = Math.max(maxUnsafe, activeUnsafe);
        }
        await sleep(40);
        if (item.concurrencySafe) activeSafe -= 1;
        else activeUnsafe -= 1;
        return item.index;
      },
      { timeoutMs: 5000 },
    );
    expect(maxSafe).toBe(2); // both safe tools ran together
    expect(maxUnsafe).toBe(1); // unsafe tools never overlapped
  });

  it('captures a per-tool timeout as a failed, timedOut outcome', async () => {
    const items: ConcurrentToolItem[] = [{ index: 0, concurrencySafe: true }];
    const outcomes = await runToolsConcurrently(
      items,
      async () => {
        await sleep(200);
        return 'never';
      },
      { timeoutMs: 40 },
    );
    expect(outcomes[0]!.ok).toBe(false);
    expect(outcomes[0]!.timedOut).toBe(true);
    expect(outcomes[0]!.error).toMatch(/timed out/i);
  });

  it('captures a thrown error without aborting sibling tools', async () => {
    const items: ConcurrentToolItem[] = [
      { index: 0, concurrencySafe: true },
      { index: 1, concurrencySafe: true },
    ];
    const outcomes = await runToolsConcurrently(
      items,
      async (item) => {
        if (item.index === 0) throw new Error('boom');
        return 'fine';
      },
      { timeoutMs: 5000 },
    );
    expect(outcomes[0]!.ok).toBe(false);
    expect(outcomes[0]!.timedOut).toBe(false);
    expect(outcomes[0]!.error).toBe('boom');
    expect(outcomes[1]!.ok).toBe(true);
    expect(outcomes[1]!.result).toBe('fine');
  });
});
