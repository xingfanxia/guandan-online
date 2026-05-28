import { describe, it, expect } from 'vitest';
import { createMemorySeenStore, createSeenStore } from '@lib/storage/seenStore';
import { createFakeRedis } from '../realtime/_fakeRedis.js';

describe('createMemorySeenStore', () => {
  it('returns null before any markSeen', async () => {
    const s = createMemorySeenStore();
    expect(await s.getSeen('A2B3C4', 'p0')).toBeNull();
  });

  it('roundtrips a per-player timestamp', async () => {
    const s = createMemorySeenStore();
    await s.markSeen('A2B3C4', 'p0', 1_700_000_000_000, 600);
    expect(await s.getSeen('A2B3C4', 'p0')).toBe(1_700_000_000_000);
    // Different player in same room is independent.
    expect(await s.getSeen('A2B3C4', 'p1')).toBeNull();
  });

  it('expires after its TTL', async () => {
    let clock = 1_700_000_000_000;
    const s = createMemorySeenStore(() => clock);
    await s.markSeen('A2B3C4', 'p0', clock, 60);
    clock += 61_000;
    expect(await s.getSeen('A2B3C4', 'p0')).toBeNull();
  });
});

describe('createSeenStore (RedisLike)', () => {
  it('roundtrips via the fake redis', async () => {
    const s = createSeenStore(createFakeRedis());
    await s.markSeen('A2B3C4', 'p0', 1_700_000_000_000, 600);
    expect(await s.getSeen('A2B3C4', 'p0')).toBe(1_700_000_000_000);
  });

  it('expires with the key TTL', async () => {
    const redis = createFakeRedis();
    const s = createSeenStore(redis);
    await s.markSeen('A2B3C4', 'p0', 1_700_000_000_000, 60);
    redis.advanceTime(61_000);
    expect(await s.getSeen('A2B3C4', 'p0')).toBeNull();
  });
});
