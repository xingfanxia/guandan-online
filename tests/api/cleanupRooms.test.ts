// Behavior tests for handleCleanupRooms — stale-room cleanup endpoint.

import { describe, expect, it } from 'vitest';
import {
  handleCleanupRooms,
  type CleanupRoomsResponseBody,
} from '@lib/api/cleanupRooms';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import type { RoomState } from '@lib/room/lifecycle';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

const ADMIN_TOKEN = 'admin-secret-xyz';

function req(opts: { method?: string; bearer?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  return new Request('http://test/', {
    method: opts.method ?? 'GET',
    headers,
  });
}

function sampleRoom(
  code: string,
  lastActiveAt: number,
  overrides: Partial<RoomState> = {}
): RoomState {
  return {
    code,
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    hostId: 'p0',
    hostToken: 'ht',
    members: [
      {
        id: 'p0',
        handle: '@host',
        joinToken: 'jt-0',
        joinedAt: lastActiveAt,
        status: 'connected',
      },
    ],
    phase: 'lobby',
    createdAt: lastActiveAt,
    lastActiveAt,
    eventVersion: 0,
    ...overrides,
  };
}

describe('handleCleanupRooms — auth', () => {
  it('returns 503 when adminToken is not configured (fail-closed)', async () => {
    const store = createMemoryRoomStore();
    const res = await handleCleanupRooms(req({ bearer: 'anything' }), {
      roomStore: store,
    });
    expect(res.status).toBe(503);
  });

  it('returns 401 when bearer is missing', async () => {
    const store = createMemoryRoomStore();
    const res = await handleCleanupRooms(req(), {
      roomStore: store,
      adminToken: ADMIN_TOKEN,
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when bearer does not match adminToken', async () => {
    const store = createMemoryRoomStore();
    const res = await handleCleanupRooms(
      req({ bearer: 'wrong-token' }),
      { roomStore: store, adminToken: ADMIN_TOKEN }
    );
    expect(res.status).toBe(401);
  });

  it('accepts a matching bearer', async () => {
    const store = createMemoryRoomStore();
    const res = await handleCleanupRooms(
      req({ bearer: ADMIN_TOKEN }),
      { roomStore: store, adminToken: ADMIN_TOKEN }
    );
    expect(res.status).toBe(200);
  });

  it('rejects unsupported methods', async () => {
    const store = createMemoryRoomStore();
    const res = await handleCleanupRooms(
      req({ method: 'DELETE', bearer: ADMIN_TOKEN }),
      { roomStore: store, adminToken: ADMIN_TOKEN }
    );
    expect(res.status).toBe(405);
  });
});

describe('handleCleanupRooms — staleness pruning', () => {
  it('reports zero stale on an empty store', async () => {
    const store = createMemoryRoomStore();
    const res = await handleCleanupRooms(
      req({ bearer: ADMIN_TOKEN }),
      { roomStore: store, adminToken: ADMIN_TOKEN }
    );
    const body = (await res.json()) as CleanupRoomsResponseBody;
    expect(body).toEqual({ scanned: 0, stale: 0, ghost: 0, deleted: 0, errors: 0 });
  });

  it('deletes rooms whose lastActiveAt exceeds stalenessMs', async () => {
    const store = createMemoryRoomStore();
    const NOW = 1_700_000_000_000;
    // Three rooms: A is fresh, B is exactly at threshold, C is way old.
    await store.create(sampleRoom('AAA111', NOW - 1 * 60 * 1000), 86_400); // 1 min ago
    await store.create(sampleRoom('BBB222', NOW - 4 * 60 * 60 * 1000), 86_400); // 4h ago (threshold)
    await store.create(sampleRoom('CCC333', NOW - 12 * 60 * 60 * 1000), 86_400); // 12h ago

    const res = await handleCleanupRooms(
      req({ bearer: ADMIN_TOKEN }),
      {
        roomStore: store,
        adminToken: ADMIN_TOKEN,
        now: () => NOW,
        stalenessMs: 4 * 60 * 60 * 1000,
      }
    );
    const body = (await res.json()) as CleanupRoomsResponseBody;
    expect(body.scanned).toBe(3);
    expect(body.stale).toBe(2); // B + C
    expect(body.deleted).toBe(2);
    expect(body.errors).toBe(0);

    expect(await store.get('AAA111')).not.toBeNull();
    expect(await store.get('BBB222')).toBeNull();
    expect(await store.get('CCC333')).toBeNull();
  });

  it('R-I1: a stale room hash is kept alive by a fresh activity side key', async () => {
    const store = createMemoryRoomStore();
    const NOW = 1_700_000_000_000;
    // Room hash looks 12h idle, but a move bumped the activity side key 1 min
    // ago — the room is mid-game and must NOT be GC'd.
    await store.create(sampleRoom('LIVE01', NOW - 12 * 60 * 60 * 1000), 86_400);
    await store.touchActivity('LIVE01', NOW - 1 * 60 * 1000, 86_400);
    // A second room is stale on the hash with NO side-key activity → deleted.
    await store.create(sampleRoom('DEAD01', NOW - 12 * 60 * 60 * 1000), 86_400);

    const res = await handleCleanupRooms(req({ bearer: ADMIN_TOKEN }), {
      roomStore: store,
      adminToken: ADMIN_TOKEN,
      now: () => NOW,
      stalenessMs: 4 * 60 * 60 * 1000,
    });
    const body = (await res.json()) as CleanupRoomsResponseBody;
    expect(body.scanned).toBe(2);
    expect(body.stale).toBe(1); // only DEAD01
    expect(body.deleted).toBe(1);
    expect(await store.get('LIVE01')).not.toBeNull();
    expect(await store.get('DEAD01')).toBeNull();
  });

  it('removes ghost index entries when the room data has TTL-expired', async () => {
    let now = 1_700_000_000_000;
    const store = createMemoryRoomStore(() => now);
    // Room with short TTL — data will expire while index lingers.
    await store.create(sampleRoom('TTL111', now), 60); // 60-second TTL
    expect(await store.listCodes()).toEqual(['TTL111']);
    now += 61_000; // wall clock past TTL
    const res = await handleCleanupRooms(
      req({ bearer: ADMIN_TOKEN }),
      { roomStore: store, adminToken: ADMIN_TOKEN, now: () => now }
    );
    const body = (await res.json()) as CleanupRoomsResponseBody;
    // Cleanup's listCodes() sees the stale code (1), get() returns null
    // because the data entry has TTL'd out → ghost path fires → delete()
    // reconciles the index.
    expect(body.scanned).toBe(1);
    expect(body.ghost).toBe(1);
    expect(body.stale).toBe(0);
    expect(body.deleted).toBe(1);
    expect(await store.listCodes()).toEqual([]);
  });

  it('preserves rooms below the staleness threshold', async () => {
    const store = createMemoryRoomStore();
    const NOW = 1_700_000_000_000;
    await store.create(sampleRoom('FRESH1', NOW - 30 * 60 * 1000), 86_400);
    const res = await handleCleanupRooms(
      req({ bearer: ADMIN_TOKEN }),
      {
        roomStore: store,
        adminToken: ADMIN_TOKEN,
        now: () => NOW,
        stalenessMs: 4 * 60 * 60 * 1000,
      }
    );
    const body = (await res.json()) as CleanupRoomsResponseBody;
    expect(body.deleted).toBe(0);
    expect(await store.get('FRESH1')).not.toBeNull();
  });

  it('respects custom stalenessMs (1 minute)', async () => {
    const store = createMemoryRoomStore();
    const NOW = 1_700_000_000_000;
    await store.create(sampleRoom('OLDIE1', NOW - 2 * 60 * 1000), 86_400); // 2 min ago
    const res = await handleCleanupRooms(
      req({ bearer: ADMIN_TOKEN }),
      {
        roomStore: store,
        adminToken: ADMIN_TOKEN,
        now: () => NOW,
        stalenessMs: 60_000, // 1 minute
      }
    );
    const body = (await res.json()) as CleanupRoomsResponseBody;
    expect(body.stale).toBe(1);
    expect(body.deleted).toBe(1);
  });
});
