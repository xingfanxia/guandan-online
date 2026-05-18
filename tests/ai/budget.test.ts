import { describe, it, expect } from 'vitest';
import {
  canAffordHardMove,
  recordHardMoveCost,
  createMemoryBudgetClient,
  DEFAULT_BUDGET,
} from '@lib/ai/budget';

describe('canAffordHardMove', () => {
  it('returns true when spend below softLimit', async () => {
    const c = createMemoryBudgetClient(10);
    expect(await canAffordHardMove(c)).toBe(true);
  });

  it('returns false at softLimit', async () => {
    const c = createMemoryBudgetClient(DEFAULT_BUDGET.softLimitUsd);
    expect(await canAffordHardMove(c)).toBe(false);
  });

  it('returns false above softLimit', async () => {
    const c = createMemoryBudgetClient(DEFAULT_BUDGET.softLimitUsd + 1);
    expect(await canAffordHardMove(c)).toBe(false);
  });

  it('honors a custom soft limit', async () => {
    const c = createMemoryBudgetClient(5);
    expect(await canAffordHardMove(c, { softLimitUsd: 4, hardLimitUsd: 10 })).toBe(false);
  });
});

describe('recordHardMoveCost', () => {
  it('records when below hardLimit', async () => {
    const c = createMemoryBudgetClient(10);
    expect(await recordHardMoveCost(c, 1)).toBe(true);
    expect(await c.currentSpend()).toBe(11);
  });

  it('returns false and does not record when crossing hardLimit', async () => {
    const c = createMemoryBudgetClient(99);
    expect(await recordHardMoveCost(c, 5)).toBe(false);
    expect(await c.currentSpend()).toBe(99);
  });
});
