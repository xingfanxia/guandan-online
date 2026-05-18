// Behavior tests for createRoomStore against the in-memory RedisLike fake.

import { describe, expect, it } from 'vitest';
import { createRoomStore } from '@lib/storage/roomStore';
import type { RoomState } from '@lib/room/lifecycle';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';
import { createFakeRedis } from '../realtime/_fakeRedis';

function sampleRoom(code: string, now = 1_700_000_000_000): RoomState {
  return {
    code,
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    hostId: 'p0',
    hostToken: 'host-secret',
    members: [
      {
        id: 'p0',
        handle: '@host',
        joinToken: 'join-token-0',
        joinedAt: now,
        status: 'connected',
      },
    ],
    phase: 'lobby',
    createdAt: now,
    lastActiveAt: now,
    eventVersion: 0,
  };
}

describe('createRoomStore — get / put roundtrip', () => {
  it('returns null for an unknown code', async () => {
    const store = createRoomStore(createFakeRedis());
    expect(await store.get('NOTREAL')).toBeNull();
  });

  it('persists and returns a room verbatim', async () => {
    const store = createRoomStore(createFakeRedis());
    const room = sampleRoom('A2B3C4');
    await store.put(room, 3600);
    const fetched = await store.get('A2B3C4');
    expect(fetched).toEqual(room);
  });

  it('put overwrites a previous value with a fresh TTL', async () => {
    const store = createRoomStore(createFakeRedis());
    const room = sampleRoom('A2B3C4');
    await store.put(room, 3600);
    const updated: RoomState = { ...room, phase: 'in_game', lastActiveAt: room.createdAt + 1000 };
    await store.put(updated, 3600);
    const fetched = await store.get('A2B3C4');
    expect(fetched?.phase).toBe('in_game');
  });
});

describe('createRoomStore — atomic create', () => {
  it('returns true on first create', async () => {
    const store = createRoomStore(createFakeRedis());
    expect(await store.create(sampleRoom('A2B3C4'), 3600)).toBe(true);
  });

  it('returns false when the code is already taken', async () => {
    const store = createRoomStore(createFakeRedis());
    await store.create(sampleRoom('A2B3C4'), 3600);
    expect(await store.create(sampleRoom('A2B3C4'), 3600)).toBe(false);
  });

  it('different codes do not collide', async () => {
    const store = createRoomStore(createFakeRedis());
    expect(await store.create(sampleRoom('A2B3C4'), 3600)).toBe(true);
    expect(await store.create(sampleRoom('D5E6F7'), 3600)).toBe(true);
  });
});

describe('createRoomStore — delete', () => {
  it('removes a room and subsequent get returns null', async () => {
    const store = createRoomStore(createFakeRedis());
    await store.put(sampleRoom('A2B3C4'), 3600);
    await store.delete('A2B3C4');
    expect(await store.get('A2B3C4')).toBeNull();
  });

  it('delete is idempotent on an unknown code', async () => {
    const store = createRoomStore(createFakeRedis());
    await expect(store.delete('NEVER')).resolves.toBeUndefined();
  });
});

describe('createRoomStore — keyPrefix isolation', () => {
  it('two stores with different prefixes do not collide', async () => {
    const redis = createFakeRedis();
    const a = createRoomStore(redis, { keyPrefix: 'a:' });
    const b = createRoomStore(redis, { keyPrefix: 'b:' });
    await a.put(sampleRoom('A2B3C4'), 3600);
    expect(await b.get('A2B3C4')).toBeNull();
    expect(await a.get('A2B3C4')).not.toBeNull();
  });
});

describe('createRoomStore — TTL', () => {
  it('expired rooms return null on subsequent get', async () => {
    const redis = createFakeRedis();
    const store = createRoomStore(redis);
    await store.put(sampleRoom('A2B3C4'), 60);
    redis.advanceTime(61_000);
    expect(await store.get('A2B3C4')).toBeNull();
  });
});
