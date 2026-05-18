import { describe, expect, it } from 'vitest';
import { createMemoryIdempotencyCache } from '@lib/realtime/idempotency';
import type { MoveResponse } from '@lib/realtime/commands';

const ok: MoveResponse = { ok: true, appliedVersion: 5, result: 'applied' };
const err: MoveResponse = { ok: false, error: 'invalid_move' };

describe('createMemoryIdempotencyCache — first-call reserve', () => {
  it('returns "reserved" for a brand-new moveId', async () => {
    const cache = createMemoryIdempotencyCache();
    const r = await cache.tryReserve('move-1', 300);
    expect(r.status).toBe('reserved');
  });

  it('returns "pending" for a second tryReserve on the same moveId before commit', async () => {
    const cache = createMemoryIdempotencyCache();
    await cache.tryReserve('move-1', 300);
    const r = await cache.tryReserve('move-1', 300);
    expect(r.status).toBe('pending');
  });

  it('returns cached result after commit', async () => {
    const cache = createMemoryIdempotencyCache();
    await cache.tryReserve('move-1', 300);
    await cache.commit('move-1', ok, 300);
    const r = await cache.tryReserve('move-1', 300);
    expect(r.status).toBe('done');
    if (r.status === 'done') {
      expect(r.result).toEqual(ok);
    }
  });

  it('cached result preserves error payloads, not just success', async () => {
    const cache = createMemoryIdempotencyCache();
    await cache.tryReserve('move-bad', 300);
    await cache.commit('move-bad', err, 300);
    const r = await cache.tryReserve('move-bad', 300);
    expect(r.status).toBe('done');
    if (r.status === 'done') {
      expect(r.result).toEqual(err);
    }
  });
});

describe('createMemoryIdempotencyCache — independence', () => {
  it('different moveIds are independent', async () => {
    const cache = createMemoryIdempotencyCache();
    await cache.tryReserve('move-1', 300);
    const r2 = await cache.tryReserve('move-2', 300);
    expect(r2.status).toBe('reserved');
  });
});

describe('createMemoryIdempotencyCache — TTL', () => {
  it('expired pending entries get a fresh "reserved" on retry', async () => {
    let t = 1000;
    const cache = createMemoryIdempotencyCache(() => t);
    await cache.tryReserve('move-1', 5); // ttl 5 seconds
    t += 6000; // advance 6 seconds
    const r = await cache.tryReserve('move-1', 5);
    expect(r.status).toBe('reserved');
  });

  it('expired done entries also yield a fresh reservation', async () => {
    let t = 1000;
    const cache = createMemoryIdempotencyCache(() => t);
    await cache.tryReserve('move-1', 5);
    await cache.commit('move-1', ok, 5);
    t += 6000;
    const r = await cache.tryReserve('move-1', 5);
    expect(r.status).toBe('reserved');
  });

  it('within-TTL done entries return cached result', async () => {
    let t = 1000;
    const cache = createMemoryIdempotencyCache(() => t);
    await cache.tryReserve('move-1', 300);
    await cache.commit('move-1', ok, 300);
    t += 100_000; // 100 seconds — well within 300s
    const r = await cache.tryReserve('move-1', 300);
    expect(r.status).toBe('done');
  });
});

describe('createMemoryIdempotencyCache — commit invariants', () => {
  it('commit without reserve throws (contract: must reserve first)', async () => {
    const cache = createMemoryIdempotencyCache();
    await expect(cache.commit('move-1', ok, 300)).rejects.toThrow(/reserve/i);
  });

  it('commit twice on the same moveId throws (idempotent — second commit is a bug)', async () => {
    const cache = createMemoryIdempotencyCache();
    await cache.tryReserve('move-1', 300);
    await cache.commit('move-1', ok, 300);
    await expect(cache.commit('move-1', ok, 300)).rejects.toThrow(/already/i);
  });
});
