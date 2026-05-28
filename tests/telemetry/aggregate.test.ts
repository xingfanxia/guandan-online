// Behavior tests for the latency telemetry store + percentile math.
// The percentile correctness tests use a KNOWN distribution so the
// nearest-rank formula is pinned exactly.

import { describe, expect, it } from 'vitest';
import {
  createMemoryLatencyStore,
  createLatencyStore,
  nearestRankPercentile,
  summarizeSamples,
  type LatencyBeacon,
  type LatencyStore,
} from '@lib/telemetry/aggregate';
import { createFakeRedis } from '@tests/realtime/_fakeRedis';

describe('nearestRankPercentile', () => {
  it('returns 0 for an empty array', () => {
    expect(nearestRankPercentile([], 50)).toBe(0);
    expect(nearestRankPercentile([], 99)).toBe(0);
  });

  it('p50 of [10,20,30,40] is 20 (rank ceil(0.5*4)=2 → index 1)', () => {
    expect(nearestRankPercentile([10, 20, 30, 40], 50)).toBe(20);
  });

  it('1..100 gives exact deciles by nearest-rank', () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(nearestRankPercentile(data, 50)).toBe(50); // rank 50
    expect(nearestRankPercentile(data, 95)).toBe(95); // rank 95
    expect(nearestRankPercentile(data, 99)).toBe(99); // rank 99
    expect(nearestRankPercentile(data, 100)).toBe(100); // rank 100
  });

  it('a single sample is every percentile', () => {
    expect(nearestRankPercentile([42], 50)).toBe(42);
    expect(nearestRankPercentile([42], 95)).toBe(42);
    expect(nearestRankPercentile([42], 99)).toBe(42);
  });

  it('p1 maps to the smallest sample (rank clamped to ≥1)', () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(nearestRankPercentile(data, 1)).toBe(1);
    // Even p0 clamps to the first element rather than index -1.
    expect(nearestRankPercentile(data, 0)).toBe(1);
  });
});

describe('summarizeSamples', () => {
  it('sorts before computing (input order does not matter)', () => {
    const summary = summarizeSamples([40, 10, 30, 20]);
    expect(summary).toEqual({ p50: 20, p95: 40, p99: 40, count: 4 });
  });

  it('reports count', () => {
    expect(summarizeSamples([1, 2, 3]).count).toBe(3);
    expect(summarizeSamples([]).count).toBe(0);
  });
});

function suites(): Array<{ name: string; make: () => LatencyStore }> {
  return [
    { name: 'memory', make: () => createMemoryLatencyStore() },
    { name: 'redis', make: () => createLatencyStore(createFakeRedis()) },
  ];
}

let clock = 0;
function beacon(region: string, rtt: number): LatencyBeacon {
  clock += 1; // unique timestamps so the Redis set members don't collide
  return { region, roundTripMs: rtt, at: clock };
}

for (const { name, make } of suites()) {
  describe(`LatencyStore (${name})`, () => {
    it('aggregate of an empty store is {}', async () => {
      const store = make();
      expect(await store.aggregate()).toEqual({});
    });

    it('computes per-region percentiles from a known distribution', async () => {
      const store = make();
      // Region A: 1..100 → p50=50, p95=95, p99=99.
      for (let i = 1; i <= 100; i++) await store.record(beacon('iad1', i));
      // Region B: four samples → p50=20, p95=40, p99=40.
      for (const v of [10, 20, 30, 40]) await store.record(beacon('hkg1', v));

      const agg = await store.aggregate();
      expect(agg['iad1']).toEqual({ p50: 50, p95: 95, p99: 99, count: 100 });
      expect(agg['hkg1']).toEqual({ p50: 20, p95: 40, p99: 40, count: 4 });
    });

    it('keeps regions isolated', async () => {
      const store = make();
      await store.record(beacon('us', 5));
      await store.record(beacon('eu', 500));
      const agg = await store.aggregate();
      expect(agg['us']!.p50).toBe(5);
      expect(agg['eu']!.p50).toBe(500);
    });
  });
}

describe('LatencyStore (memory) — sample cap', () => {
  it('retains only the newest maxSamples per region', async () => {
    const store = createMemoryLatencyStore({ maxSamples: 3 });
    // Push 1,2,3,4,5 — only 3,4,5 should remain.
    for (const v of [1, 2, 3, 4, 5]) await store.record(beacon('x', v));
    const agg = await store.aggregate();
    expect(agg['x']!.count).toBe(3);
    expect(agg['x']!.p50).toBe(4); // p50 of [3,4,5] = rank 2 → 4
  });
});
