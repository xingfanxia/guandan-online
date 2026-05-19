import { describe, it, expect } from 'vitest';
import {
  canAffordHardMove,
  recordHardMoveCost,
  createMemoryBudgetClient,
  createUpstashBudget,
  budgetKeyForMonth,
  DEFAULT_BUDGET,
} from '@lib/ai/budget';
import { createFakeRedis } from '../realtime/_fakeRedis';

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

describe('budgetKeyForMonth', () => {
  it('produces ai:budget:YYYY-MM with zero-padded month', () => {
    expect(budgetKeyForMonth(new Date('2026-05-18T00:00:00Z'))).toBe('ai:budget:2026-05');
    expect(budgetKeyForMonth(new Date('2026-01-01T00:00:00Z'))).toBe('ai:budget:2026-01');
    expect(budgetKeyForMonth(new Date('2026-12-31T23:59:59Z'))).toBe('ai:budget:2026-12');
  });

  it('uses UTC, not the local timezone', () => {
    // 2026-12-31 23:30 UTC is still December in UTC even if the test box is
    // running in a timezone that already rolled to Jan. Pinning to UTC keeps
    // the budget bucket consistent across server regions.
    expect(budgetKeyForMonth(new Date('2026-12-31T23:30:00Z'))).toBe('ai:budget:2026-12');
  });
});

describe('createUpstashBudget', () => {
  const fixedDate = new Date('2026-05-18T12:00:00Z');
  const now = () => fixedDate;

  it('returns 0 when the month key has no value yet', async () => {
    const redis = createFakeRedis();
    const client = createUpstashBudget(redis, now);
    expect(await client.currentSpend()).toBe(0);
  });

  it('round-trips through Upstash: recordCost then currentSpend returns the total', async () => {
    const redis = createFakeRedis();
    const client = createUpstashBudget(redis, now);
    await client.recordCost(1.5);
    await client.recordCost(2.25);
    expect(await client.currentSpend()).toBeCloseTo(3.75);
  });

  it('writes to the YYYY-MM-keyed bucket only (not a generic key)', async () => {
    const redis = createFakeRedis();
    const client = createUpstashBudget(redis, now);
    await client.recordCost(0.5);
    expect(redis.__peek('ai:budget:2026-05')).not.toBeNull();
    expect(redis.__peek('ai:budget')).toBeNull();
  });

  it('persists across separate client instances backed by the same redis', async () => {
    // Models the "function instance reused across invocations" scenario
    // — the second invocation should see the first's recorded cost.
    const redis = createFakeRedis();
    const a = createUpstashBudget(redis, now);
    await a.recordCost(10);
    const b = createUpstashBudget(redis, now);
    expect(await b.currentSpend()).toBe(10);
  });

  it('canAffordHardMove + recordHardMoveCost compose with the Upstash client', async () => {
    const redis = createFakeRedis();
    const client = createUpstashBudget(redis, now);
    expect(await canAffordHardMove(client)).toBe(true);
    await client.recordCost(DEFAULT_BUDGET.softLimitUsd);
    expect(await canAffordHardMove(client)).toBe(false);
  });

  it('uses different buckets when the injected clock crosses months', async () => {
    const redis = createFakeRedis();
    let mockDate = new Date('2026-05-18T12:00:00Z');
    const client = createUpstashBudget(redis, () => mockDate);
    await client.recordCost(7);
    expect(await client.currentSpend()).toBe(7);
    mockDate = new Date('2026-06-01T00:00:00Z');
    // June bucket is fresh
    expect(await client.currentSpend()).toBe(0);
  });
});
