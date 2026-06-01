import { describe, expect, test } from '@jest/globals';
import { CircuitOpenError, ToolCircuitBreaker } from './clio-circuit-breaker.js';

function fixedClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('ToolCircuitBreaker', () => {
  test('opens after the failure threshold and stays open during cooldown', () => {
    const clock = fixedClock();
    const cb = new ToolCircuitBreaker({ threshold: 3, cooldownMs: 30_000, now: clock.now });
    cb.recordFailure('t:a');
    cb.recordFailure('t:a');
    expect(cb.isOpen('t:a')).toBe(false); // 2 < threshold
    cb.recordFailure('t:a');
    expect(cb.isOpen('t:a')).toBe(true); // tripped at 3
    clock.advance(29_000);
    expect(cb.isOpen('t:a')).toBe(true);
  });

  test('closes after the cooldown elapses (half-open)', () => {
    const clock = fixedClock();
    const cb = new ToolCircuitBreaker({ threshold: 1, cooldownMs: 10_000, now: clock.now });
    cb.recordFailure('t:a');
    expect(cb.isOpen('t:a')).toBe(true);
    clock.advance(10_001);
    expect(cb.isOpen('t:a')).toBe(false);
  });

  test('success resets the streak', () => {
    const clock = fixedClock();
    const cb = new ToolCircuitBreaker({ threshold: 2, cooldownMs: 5_000, now: clock.now });
    cb.recordFailure('t:a');
    cb.recordSuccess('t:a');
    cb.recordFailure('t:a');
    expect(cb.isOpen('t:a')).toBe(false); // streak reset, only 1 failure since
  });

  test('breakers are independent per key (tenant isolation)', () => {
    const clock = fixedClock();
    const cb = new ToolCircuitBreaker({ threshold: 1, cooldownMs: 5_000, now: clock.now });
    cb.recordFailure('tenantA:search');
    expect(cb.isOpen('tenantA:search')).toBe(true);
    expect(cb.isOpen('tenantB:search')).toBe(false);
  });

  test('CircuitOpenError carries the tool name', () => {
    const err = new CircuitOpenError('search_research_sources');
    expect(err).toBeInstanceOf(Error);
    expect(err.tool).toBe('search_research_sources');
    expect(err.name).toBe('CircuitOpenError');
  });
});
