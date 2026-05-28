// Behavior tests for the profile store — memory + Redis impls over RedisLike.

import { describe, expect, it } from 'vitest';
import {
  createMemoryProfileStore,
  createProfileStore,
  type ProfileStore,
} from '@lib/storage/profileStore';
import { createFakeRedis } from '@tests/realtime/_fakeRedis';

// Run the same behavior suite against both implementations so they can't drift.
function suites(): Array<{ name: string; make: () => ProfileStore }> {
  return [
    { name: 'memory', make: () => createMemoryProfileStore() },
    { name: 'redis', make: () => createProfileStore(createFakeRedis()) },
  ];
}

for (const { name, make } of suites()) {
  describe(`ProfileStore (${name})`, () => {
    it('returns null for an unknown handle', async () => {
      const store = make();
      expect(await store.get('@nobody')).toBeNull();
    });

    it('put then get round-trips the profile', async () => {
      const store = make();
      const profile = { handle: '@阿祥', createdAt: 1000, banned: false, gamesPlayed: 3 };
      await store.put(profile);
      expect(await store.get('@阿祥')).toEqual(profile);
    });

    it('isBanned is false for an unknown handle', async () => {
      const store = make();
      expect(await store.isBanned('@ghost')).toBe(false);
    });

    it('setBanned creates a profile when none exists and flips isBanned', async () => {
      const store = make();
      const result = await store.setBanned('@cheater', true);
      expect(result.handle).toBe('@cheater');
      expect(result.banned).toBe(true);
      expect(await store.isBanned('@cheater')).toBe(true);
    });

    it('setBanned preserves existing fields (createdAt, gamesPlayed)', async () => {
      const store = make();
      await store.put({ handle: '@老郭', createdAt: 555, banned: false, gamesPlayed: 7 });
      const banned = await store.setBanned('@老郭', true);
      expect(banned).toEqual({ handle: '@老郭', createdAt: 555, banned: true, gamesPlayed: 7 });
      const unbanned = await store.setBanned('@老郭', false);
      expect(unbanned.banned).toBe(false);
      expect(unbanned.gamesPlayed).toBe(7);
    });

    it('resetStats zeroes gamesPlayed but keeps other fields', async () => {
      const store = make();
      await store.put({ handle: '@饭团', createdAt: 100, banned: true, gamesPlayed: 42 });
      const reset = await store.resetStats('@饭团');
      expect(reset).toEqual({ handle: '@饭团', createdAt: 100, banned: true, gamesPlayed: 0 });
    });

    it('resetStats returns null when the handle has no profile', async () => {
      const store = make();
      expect(await store.resetStats('@unknown')).toBeNull();
    });
  });
}

describe('ProfileStore (memory) — TTL', () => {
  it('expires a profile after its TTL elapses', async () => {
    let now = 1_000_000;
    const store = createMemoryProfileStore(() => now);
    await store.put({ handle: '@temp', createdAt: now, banned: false }, 60);
    expect(await store.get('@temp')).not.toBeNull();
    now += 61_000;
    expect(await store.get('@temp')).toBeNull();
  });

  it('a profile written without a TTL never expires', async () => {
    let now = 1_000_000;
    const store = createMemoryProfileStore(() => now);
    await store.put({ handle: '@perm', createdAt: now, banned: false });
    now += 10 * 365 * 24 * 60 * 60 * 1000; // 10 years later
    expect(await store.get('@perm')).not.toBeNull();
  });
});
