// Behavior tests for createUpstashIdempotencyCache against the in-memory
// RedisLike fake. The fake mirrors the @upstash/redis semantics we depend on
// (NX, EX, auto-JSON-parsing GET) — so passing tests here imply equivalent
// behavior on a real Upstash instance modulo network-level concerns.

import { describe, expect, it } from 'vitest';
import { createUpstashIdempotencyCache } from '@lib/realtime/idempotency';
import type { MoveResponse } from '@lib/realtime/commands';
import { createFakeRedis } from './_fakeRedis';

const ok: MoveResponse = { ok: true, appliedVersion: 5, result: 'applied' };
const err: MoveResponse = { ok: false, error: 'invalid_move' };

describe('createUpstashIdempotencyCache — reserve / commit / replay', () => {
  it('returns "reserved" for a brand-new moveId', async () => {
    const redis = createFakeRedis();
    const cache = createUpstashIdempotencyCache(redis);
    const r = await cache.tryReserve('move-1', 300);
    expect(r.status).toBe('reserved');
  });

  it('returns "pending" on second reserve before commit', async () => {
    const redis = createFakeRedis();
    const cache = createUpstashIdempotencyCache(redis);
    await cache.tryReserve('move-1', 300);
    const r = await cache.tryReserve('move-1', 300);
    expect(r.status).toBe('pending');
  });

  it('returns cached "done" result after commit', async () => {
    const redis = createFakeRedis();
    const cache = createUpstashIdempotencyCache(redis);
    await cache.tryReserve('move-1', 300);
    await cache.commit('move-1', ok, 300);
    const r = await cache.tryReserve('move-1', 300);
    expect(r.status).toBe('done');
    if (r.status === 'done') {
      expect(r.result).toEqual(ok);
    }
  });

  it('cached result preserves error payloads, not just success', async () => {
    const redis = createFakeRedis();
    const cache = createUpstashIdempotencyCache(redis);
    await cache.tryReserve('move-bad', 300);
    await cache.commit('move-bad', err, 300);
    const r = await cache.tryReserve('move-bad', 300);
    expect(r.status).toBe('done');
    if (r.status === 'done') {
      expect(r.result).toEqual(err);
    }
  });
});

describe('createUpstashIdempotencyCache — independence', () => {
  it('different moveIds are independent', async () => {
    const redis = createFakeRedis();
    const cache = createUpstashIdempotencyCache(redis);
    await cache.tryReserve('move-1', 300);
    const r2 = await cache.tryReserve('move-2', 300);
    expect(r2.status).toBe('reserved');
  });

  it('different keyPrefix instances do not collide', async () => {
    const redis = createFakeRedis();
    const a = createUpstashIdempotencyCache(redis, 'a:');
    const b = createUpstashIdempotencyCache(redis, 'b:');
    await a.tryReserve('move-1', 300);
    const r = await b.tryReserve('move-1', 300);
    expect(r.status).toBe('reserved');
  });
});

describe('createUpstashIdempotencyCache — TTL', () => {
  it('expired pending entries yield fresh "reserved" on retry', async () => {
    const redis = createFakeRedis();
    const cache = createUpstashIdempotencyCache(redis);
    await cache.tryReserve('move-1', 5);
    redis.advanceTime(6000);
    const r = await cache.tryReserve('move-1', 5);
    expect(r.status).toBe('reserved');
  });

  it('expired done entries also yield fresh "reserved"', async () => {
    const redis = createFakeRedis();
    const cache = createUpstashIdempotencyCache(redis);
    await cache.tryReserve('move-1', 5);
    await cache.commit('move-1', ok, 5);
    redis.advanceTime(6000);
    const r = await cache.tryReserve('move-1', 5);
    expect(r.status).toBe('reserved');
  });

  it('within-TTL done entries return cached result', async () => {
    const redis = createFakeRedis();
    const cache = createUpstashIdempotencyCache(redis);
    await cache.tryReserve('move-1', 300);
    await cache.commit('move-1', ok, 300);
    redis.advanceTime(100_000);
    const r = await cache.tryReserve('move-1', 300);
    expect(r.status).toBe('done');
  });
});

describe('createUpstashIdempotencyCache — commit invariants', () => {
  it('commit without reserve throws (must reserve first)', async () => {
    const redis = createFakeRedis();
    const cache = createUpstashIdempotencyCache(redis);
    await expect(cache.commit('move-1', ok, 300)).rejects.toThrow(/reserve/i);
  });

  it('commit twice on the same moveId throws', async () => {
    const redis = createFakeRedis();
    const cache = createUpstashIdempotencyCache(redis);
    await cache.tryReserve('move-1', 300);
    await cache.commit('move-1', ok, 300);
    await expect(cache.commit('move-1', ok, 300)).rejects.toThrow(/already/i);
  });
});

describe('createUpstashIdempotencyCache — redis key shape', () => {
  it('stores PENDING sentinel after reserve, then JSON after commit', async () => {
    const redis = createFakeRedis();
    const cache = createUpstashIdempotencyCache(redis, 'idem:');
    await cache.tryReserve('abc', 300);
    expect(redis.__peek('idem:abc')).toBe('PENDING');
    await cache.commit('abc', ok, 300);
    const stored = redis.__peek('idem:abc');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual(ok);
  });
});
