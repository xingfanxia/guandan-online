// Behavior tests for the account-creation throttle (SEC-2).
//
// The counting contract (allow ≤ cap, deny the 6th, independent IP buckets,
// denied-attempts-still-count) is asserted against BOTH the memory impl and
// the Upstash impl over the in-memory RedisLike fake.
//
// Window expiry: the in-memory RedisLike fake intentionally does NOT model TTL
// on counter cells (see tests/realtime/_fakeRedis.ts — "Tests don't expire
// counters yet"), so "the window resets after 24h" is asserted directly on the
// memory backend (which we drive via the `now` arg) and, for the Redis impl,
// via the EXPIRE-on-first-INCR mechanism that produces that reset on real
// Upstash. Both halves of the acceptance criterion are therefore covered.

import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryIpThrottle,
  createIpThrottle,
  DEFAULT_MAX_ACCOUNTS,
  DEFAULT_WINDOW_SECONDS,
  type IpThrottle,
} from '@lib/security/ipThrottle';
import { createFakeRedis } from '../realtime/_fakeRedis.js';

const HASH_A = 'aaaa1111';
const HASH_B = 'bbbb2222';
const T0 = 1_700_000_000_000;

// Backend abstraction so the shared counting contract runs on both impls. The
// memory impl is clock-driven via the `now` arg; the Redis impl relies on the
// fake's INCR (so `now` is a no-op for it).
interface Backend {
  name: string;
  throttle: IpThrottle;
  now(): number;
}

function memoryBackend(): Backend {
  const throttle = createMemoryIpThrottle(() => T0);
  return { name: 'memory', throttle, now: () => T0 };
}

function redisBackend(): Backend {
  const throttle = createIpThrottle(createFakeRedis());
  return { name: 'redis', throttle, now: () => T0 };
}

for (const make of [memoryBackend, redisBackend]) {
  describe(`IpThrottle counting contract [${make().name}]`, () => {
    it('allows the first registration with count 1', async () => {
      const b = make();
      expect(await b.throttle.tryRegister(HASH_A, b.now())).toEqual({
        allowed: true,
        count: 1,
      });
    });

    it('allows up to the default cap (5), denies the 6th', async () => {
      const b = make();
      for (let i = 1; i <= DEFAULT_MAX_ACCOUNTS; i++) {
        const r = await b.throttle.tryRegister(HASH_A, b.now());
        expect(r.allowed).toBe(true);
        expect(r.count).toBe(i);
      }
      const sixth = await b.throttle.tryRegister(HASH_A, b.now());
      expect(sixth.allowed).toBe(false);
      expect(sixth.count).toBe(6);
    });

    it('counts each IP hash independently', async () => {
      const b = make();
      for (let i = 0; i < DEFAULT_MAX_ACCOUNTS; i++) {
        await b.throttle.tryRegister(HASH_A, b.now());
      }
      expect((await b.throttle.tryRegister(HASH_A, b.now())).allowed).toBe(false);
      // B is untouched — still allowed.
      expect(await b.throttle.tryRegister(HASH_B, b.now())).toEqual({
        allowed: true,
        count: 1,
      });
    });

    it('keeps incrementing past the cap (a denied attempt still counts)', async () => {
      const b = make();
      for (let i = 0; i < DEFAULT_MAX_ACCOUNTS; i++) {
        await b.throttle.tryRegister(HASH_A, b.now());
      }
      const sixth = await b.throttle.tryRegister(HASH_A, b.now());
      const seventh = await b.throttle.tryRegister(HASH_A, b.now());
      expect(sixth.count).toBe(6);
      expect(seventh.count).toBe(7);
      expect(seventh.allowed).toBe(false);
    });
  });
}

// ─── Window expiry — memory backend (clock-driven) ──────────────────────────

describe('IpThrottle window expiry [memory]', () => {
  it('resets after the 24h window — a fresh registration is allowed again', async () => {
    let clock = T0;
    const throttle = createMemoryIpThrottle(() => clock);
    for (let i = 0; i < DEFAULT_MAX_ACCOUNTS; i++) {
      await throttle.tryRegister(HASH_A, clock);
    }
    expect((await throttle.tryRegister(HASH_A, clock)).allowed).toBe(false);

    clock += DEFAULT_WINDOW_SECONDS * 1000 + 1; // just past the window
    expect(await throttle.tryRegister(HASH_A, clock)).toEqual({ allowed: true, count: 1 });
  });

  it('does NOT reset before the window elapses', async () => {
    let clock = T0;
    const throttle = createMemoryIpThrottle(() => clock);
    for (let i = 0; i < DEFAULT_MAX_ACCOUNTS; i++) {
      await throttle.tryRegister(HASH_A, clock);
    }
    clock += DEFAULT_WINDOW_SECONDS * 1000 - 1000; // just before the boundary
    expect((await throttle.tryRegister(HASH_A, clock)).allowed).toBe(false);
  });

  it('honors a custom max', async () => {
    const throttle = createMemoryIpThrottle(() => T0, { max: 2 });
    expect((await throttle.tryRegister(HASH_A, T0)).allowed).toBe(true);
    expect((await throttle.tryRegister(HASH_A, T0)).allowed).toBe(true);
    expect((await throttle.tryRegister(HASH_A, T0)).allowed).toBe(false);
  });

  it('honors a custom window', async () => {
    let clock = T0;
    const throttle = createMemoryIpThrottle(() => clock, { max: 1, windowSeconds: 60 });
    expect((await throttle.tryRegister(HASH_A, clock)).allowed).toBe(true);
    expect((await throttle.tryRegister(HASH_A, clock)).allowed).toBe(false);
    clock += 61_000;
    expect((await throttle.tryRegister(HASH_A, clock)).allowed).toBe(true);
  });
});

// ─── Window expiry — Redis backend (EXPIRE-on-first-INCR mechanism) ──────────
//
// The fake doesn't TTL counters, so we verify the mechanism that yields the
// reset on real Upstash: EXPIRE is called exactly once, on the first INCR, with
// the 24h window — and NOT re-armed on later increments (Redis INCR doesn't
// refresh TTL).

describe('IpThrottle window expiry [redis] — EXPIRE mechanism', () => {
  it('arms EXPIRE on the first increment with the default 24h window, once only', async () => {
    const redis = createFakeRedis();
    const expireSpy = vi.spyOn(redis, 'expire');
    const throttle = createIpThrottle(redis);

    await throttle.tryRegister(HASH_A, T0); // count 1 → EXPIRE armed
    await throttle.tryRegister(HASH_A, T0); // count 2 → no re-arm
    await throttle.tryRegister(HASH_A, T0); // count 3 → no re-arm

    expect(expireSpy).toHaveBeenCalledTimes(1);
    expect(expireSpy).toHaveBeenCalledWith('ipacct:aaaa1111', DEFAULT_WINDOW_SECONDS);
  });

  it('uses a custom window when supplied', async () => {
    const redis = createFakeRedis();
    const expireSpy = vi.spyOn(redis, 'expire');
    const throttle = createIpThrottle(redis, { windowSeconds: 3600, keyPrefix: 'acct2:' });
    await throttle.tryRegister(HASH_A, T0);
    expect(expireSpy).toHaveBeenCalledWith('acct2:aaaa1111', 3600);
  });

  it('keys the counter under the prefix', async () => {
    const redis = createFakeRedis();
    const incrSpy = vi.spyOn(redis, 'incr');
    const throttle = createIpThrottle(redis, { keyPrefix: 'acct2:' });
    await throttle.tryRegister(HASH_A, T0);
    expect(incrSpy).toHaveBeenCalledWith('acct2:aaaa1111');
  });
});
