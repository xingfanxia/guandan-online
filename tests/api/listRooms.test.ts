// Behavior tests for handleListRooms — the ROOM-3 public browse list.

import { describe, expect, it } from 'vitest';
import {
  handleListRooms,
  type ListRoomsResponseBody,
} from '@lib/api/listRooms';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import type { RoomState } from '@lib/room/lifecycle';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

const NOW = 1_700_000_000_000;

function room(
  code: string,
  overrides: Partial<RoomState> = {}
): RoomState {
  return {
    code,
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    hostId: 'p0',
    hostToken: `ht-${code}`,
    members: [
      {
        id: 'p0',
        handle: '@host',
        joinToken: `jt-${code}`,
        joinedAt: NOW,
        status: 'connected',
      },
    ],
    phase: 'lobby',
    createdAt: NOW,
    lastActiveAt: NOW,
    eventVersion: 0,
    visibility: 'public',
    ...overrides,
  };
}

function req(): Request {
  return new Request('http://test/api/rooms', { method: 'GET' });
}

async function listed(store: ReturnType<typeof createMemoryRoomStore>) {
  const res = await handleListRooms(req(), { roomStore: store });
  expect(res.status).toBe(200);
  return ((await res.json()) as ListRoomsResponseBody).rooms;
}

describe('handleListRooms', () => {
  it('lists public lobby rooms with open seats, newest first', async () => {
    const store = createMemoryRoomStore(() => NOW);
    await store.create(room('AAA111', { createdAt: NOW - 2000 }), 86_400);
    await store.create(room('BBB222', { createdAt: NOW - 1000 }), 86_400);
    const rooms = await listed(store);
    expect(rooms.map((r) => r.code)).toEqual(['BBB222', 'AAA111']);
    const first = rooms[0]!;
    expect(first.mode).toBe('4');
    expect(first.seatsFilled).toBe(1);
    expect(first.seatsTotal).toBe(4);
    expect(first.hostHandle).toBe('@host');
    expect(first.strictA).toBe(true);
  });

  it('excludes private rooms (and legacy rooms without the flag)', async () => {
    const store = createMemoryRoomStore(() => NOW);
    await store.create(room('PRIV01', { visibility: 'private' }), 86_400);
    const legacy = room('LEGACY');
    delete (legacy as Partial<RoomState>).visibility;
    await store.create(legacy, 86_400);
    expect(await listed(store)).toEqual([]);
  });

  it('excludes in-game and full rooms', async () => {
    const store = createMemoryRoomStore(() => NOW);
    await store.create(room('INGAME', { phase: 'in_game' }), 86_400);
    const full = room('FULL01');
    full.members = ['p0', 'p1', 'p2', 'p3'].map((id, i) => ({
      id,
      handle: `@m${i}`,
      joinToken: `jt-${i}`,
      joinedAt: NOW,
      status: 'connected' as const,
    }));
    await store.create(full, 86_400);
    expect(await listed(store)).toEqual([]);
  });

  it('never leaks tokens in the response payload', async () => {
    const store = createMemoryRoomStore(() => NOW);
    await store.create(room('TOK001'), 86_400);
    const res = await handleListRooms(req(), { roomStore: store });
    const raw = await res.text();
    expect(raw).not.toContain('ht-TOK001');
    expect(raw).not.toContain('jt-TOK001');
  });

  it('rejects non-GET', async () => {
    const store = createMemoryRoomStore(() => NOW);
    const res = await handleListRooms(
      new Request('http://test/api/rooms', { method: 'POST' }),
      { roomStore: store }
    );
    expect(res.status).toBe(405);
  });
});
