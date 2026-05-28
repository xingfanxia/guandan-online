// Behavior tests for the report store — memory + Redis impls over RedisLike.
// Core invariant under test: dedupe on the (reporter, target, gameId) tuple.

import { describe, expect, it } from 'vitest';
import {
  createMemoryReportStore,
  createReportStore,
  type PlayerReport,
  type ReportStore,
} from '@lib/security/reports';
import { createFakeRedis } from '@tests/realtime/_fakeRedis';

function report(overrides: Partial<PlayerReport> = {}): PlayerReport {
  return {
    reporterHandle: '@阿祥',
    targetHandle: '@老郭',
    gameId: 'G1',
    reason: 'cheating',
    createdAt: 1000,
    ...overrides,
  };
}

function suites(): Array<{ name: string; make: () => ReportStore }> {
  return [
    { name: 'memory', make: () => createMemoryReportStore() },
    { name: 'redis', make: () => createReportStore(createFakeRedis()) },
  ];
}

for (const { name, make } of suites()) {
  describe(`ReportStore (${name})`, () => {
    it('records a fresh report (not deduped)', async () => {
      const store = make();
      const result = await store.record(report());
      expect(result.deduped).toBe(false);
      expect(result.report.targetHandle).toBe('@老郭');
    });

    it('dedupes a second identical (reporter,target,game) tuple', async () => {
      const store = make();
      await store.record(report({ createdAt: 1000 }));
      const second = await store.record(report({ createdAt: 2000, reason: 'abuse' }));
      expect(second.deduped).toBe(true);
      // Still only one entry in the recency window.
      const recent = await store.listRecent(10);
      expect(recent).toHaveLength(1);
    });

    it('does NOT dedupe across different gameIds', async () => {
      const store = make();
      const a = await store.record(report({ gameId: 'G1' }));
      const b = await store.record(report({ gameId: 'G2' }));
      expect(a.deduped).toBe(false);
      expect(b.deduped).toBe(false);
      expect(await store.listRecent(10)).toHaveLength(2);
    });

    it('does NOT dedupe across different targets', async () => {
      const store = make();
      await store.record(report({ targetHandle: '@老郭' }));
      const other = await store.record(report({ targetHandle: '@饭团' }));
      expect(other.deduped).toBe(false);
      expect(await store.listRecent(10)).toHaveLength(2);
    });

    it('does NOT dedupe across different reporters', async () => {
      const store = make();
      await store.record(report({ reporterHandle: '@阿祥' }));
      const other = await store.record(report({ reporterHandle: '@泉酱' }));
      expect(other.deduped).toBe(false);
      expect(await store.listRecent(10)).toHaveLength(2);
    });

    it('has() reflects whether a tuple was recorded', async () => {
      const store = make();
      expect(await store.has('@阿祥', '@老郭', 'G1')).toBe(false);
      await store.record(report());
      expect(await store.has('@阿祥', '@老郭', 'G1')).toBe(true);
      expect(await store.has('@阿祥', '@老郭', 'G2')).toBe(false);
    });

    it('listRecent returns newest-first and respects the limit', async () => {
      const store = make();
      await store.record(report({ gameId: 'G1', createdAt: 100 }));
      await store.record(report({ gameId: 'G2', createdAt: 200 }));
      await store.record(report({ gameId: 'G3', createdAt: 300 }));
      const recent = await store.listRecent(2);
      expect(recent).toHaveLength(2);
      expect(recent[0]!.gameId).toBe('G3'); // newest
      expect(recent[1]!.gameId).toBe('G2');
    });

    it('listRecent with limit 0 returns nothing', async () => {
      const store = make();
      await store.record(report());
      expect(await store.listRecent(0)).toHaveLength(0);
    });
  });
}

describe('ReportStore (memory) — recency window cap', () => {
  it('drops the oldest beyond maxRecent', async () => {
    const store = createMemoryReportStore({ maxRecent: 2 });
    await store.record(report({ gameId: 'G1', createdAt: 1 }));
    await store.record(report({ gameId: 'G2', createdAt: 2 }));
    await store.record(report({ gameId: 'G3', createdAt: 3 }));
    const recent = await store.listRecent(10);
    expect(recent.map((r) => r.gameId)).toEqual(['G3', 'G2']);
  });
});
