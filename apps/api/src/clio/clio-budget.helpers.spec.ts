import { describe, expect, test } from '@jest/globals';
import { loopBudgetExceeded } from './clio-budget.helpers.js';

describe('loopBudgetExceeded', () => {
  test('proceeds while under both round cap and time budget', () => {
    expect(
      loopBudgetExceeded({ round: 2, maxRounds: 8, elapsedMs: 1000, budgetMs: 90_000 }),
    ).toBeNull();
  });

  test('stops at the round cap', () => {
    expect(loopBudgetExceeded({ round: 8, maxRounds: 8, elapsedMs: 0, budgetMs: 90_000 })).toBe(
      'max_rounds',
    );
  });

  test('stops when the time budget is exhausted', () => {
    expect(
      loopBudgetExceeded({ round: 1, maxRounds: 8, elapsedMs: 90_000, budgetMs: 90_000 }),
    ).toBe('time_budget');
    expect(
      loopBudgetExceeded({ round: 1, maxRounds: 8, elapsedMs: 90_001, budgetMs: 90_000 }),
    ).toBe('time_budget');
  });

  test('round cap takes precedence over time budget', () => {
    expect(
      loopBudgetExceeded({ round: 8, maxRounds: 8, elapsedMs: 90_000, budgetMs: 90_000 }),
    ).toBe('max_rounds');
  });

  test('a non-positive budget disables the time check', () => {
    expect(
      loopBudgetExceeded({ round: 1, maxRounds: 8, elapsedMs: 10_000_000, budgetMs: 0 }),
    ).toBeNull();
  });
});
