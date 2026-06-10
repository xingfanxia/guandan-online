// Stream purge — guaranteed reclamation of per-recipient event/bus streams.
//
// REGRESSION (code-review MEDIUM, 2026-06-09): TTL refresh on stream keys is
// fire-and-forget since the publish-latency work; if the FIRST expire after a
// stream's creating XADD drops, the key has no TTL and the cleanup cron used
// to delete only the room record — a permanent leak. The cron now purges
// streams for stale rooms via createStreamPurge.

import { describe, expect, it } from 'vitest';
import { createStreamPurge } from '@lib/realtime/streamPurge';
import {
  handleCleanupRooms,
  type CleanupRoomsResponseBody,
} from '@lib/api/cleanupRooms';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import type { RoomState } from '@lib/room/lifecycle';
import type { RedisLike } from '@lib/realtime/redisClient';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

function fakeRedisWithDel(): { redis: RedisLike; deleted: string[] } {
  const deleted: string[] = [];
  const redis = {
    del: async (key: string) => {
      deleted.push(key);
      return 1;
    },
  } as unknown as RedisLike;
  return { redis, deleted };
}

describe('createStreamPurge', () => {
  it('deletes both the event-log and bus stream for every member', async () => {
    const { redis, deleted } = fakeRedisWithDel();
    const purge = createStreamPurge(redis);
    await purge('R7M2K9', ['p0', 'p1']);
    expect(deleted.sort()).toEqual(
      [
        'events:R7M2K9:p0',
        'events:R7M2K9:p1',
        'bus:game:R7M2K9:player:p0',
        'bus:game:R7M2K9:player:p1',
      ].sort(),
    );
  });

  it('is a no-op on the memory backend (null redis)', async () => {
    const purge = createStreamPurge(null);
    await expect(purge('R7M2K9', ['p0'])).resolves.toBeUndefined();
  });

  it('swallows individual del failures (best-effort)', async () => {
    const redis = {
      del: async (key: string) => {
        if (key.startsWith('events:')) throw new Error('boom');
        return 1;
      },
    } as unknown as RedisLike;
    const purge = createStreamPurge(redis);
    await expect(purge('R7M2K9', ['p0'])).resolves.toBeUndefined();
  });
});

describe('handleCleanupRooms — stream purge wiring', () => {
  const ADMIN_TOKEN = 'admin-secret-xyz';
  const NOW = 1_700_000_000_000;

  function room(code: string, lastActiveAt: number): RoomState {
    return {
      code,
      mode: '4',
      rules: DEFAULT_MODE_RULES,
      hostId: 'p0',
      hostToken: 'ht',
      members: [
        { id: 'p0', handle: '@host', joinToken: 'jt-0', joinedAt: lastActiveAt, status: 'connected' },
        { id: 'p1', handle: '@bot', joinToken: 'jt-1', joinedAt: lastActiveAt, status: 'bot' },
      ],
      phase: 'lobby',
      createdAt: lastActiveAt,
      lastActiveAt,
      eventVersion: 0,
    };
  }

  it('purges streams for stale rooms with the member ids, not for fresh ones', async () => {
    const store = createMemoryRoomStore();
    await store.create(room('FRESH1', NOW - 60_000), 86_400);
    await store.create(room('STALE1', NOW - 12 * 60 * 60 * 1000), 86_400);

    const purged: Array<{ roomId: string; members: readonly string[] }> = [];
    const res = await handleCleanupRooms(
      new Request('http://test/', {
        method: 'GET',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      }),
      {
        roomStore: store,
        adminToken: ADMIN_TOKEN,
        now: () => NOW,
        stalenessMs: 4 * 60 * 60 * 1000,
        purgeStreams: async (roomId, members) => {
          purged.push({ roomId, members });
        },
      },
    );
    const body = (await res.json()) as CleanupRoomsResponseBody;
    expect(body.stale).toBe(1);
    expect(purged).toEqual([{ roomId: 'STALE1', members: ['p0', 'p1'] }]);
  });

  it('still deletes the room when the purge throws', async () => {
    const store = createMemoryRoomStore();
    await store.create(room('STALE2', NOW - 12 * 60 * 60 * 1000), 86_400);

    const res = await handleCleanupRooms(
      new Request('http://test/', {
        method: 'GET',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      }),
      {
        roomStore: store,
        adminToken: ADMIN_TOKEN,
        now: () => NOW,
        stalenessMs: 4 * 60 * 60 * 1000,
        purgeStreams: async () => {
          throw new Error('redis down');
        },
      },
    );
    const body = (await res.json()) as CleanupRoomsResponseBody;
    expect(body.deleted).toBe(1);
    expect(body.errors).toBe(0);
    expect(await store.get('STALE2')).toBeNull();
  });
});
