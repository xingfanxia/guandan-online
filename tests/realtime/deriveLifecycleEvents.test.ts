import { describe, expect, it } from 'vitest';
import {
  deriveRoomJoined,
  deriveRoomLeft,
} from '@lib/realtime/deriveLifecycleEvents';
import type { RoomState } from '@lib/room/lifecycle';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'A2B3C4',
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    hostId: 'p0',
    hostToken: 'host-tok',
    members: [
      {
        id: 'p0',
        handle: '@host',
        joinToken: 'jt-0',
        joinedAt: 0,
        status: 'connected',
      },
    ],
    phase: 'lobby',
    createdAt: 0,
    lastActiveAt: 0,
    eventVersion: 0,
    ...overrides,
  };
}

describe('deriveRoomJoined', () => {
  it('returns [] when no new member', () => {
    const pre = room();
    expect(deriveRoomJoined({ preState: pre, postState: pre })).toEqual([]);
  });

  it('emits room_joined for a single new member at postState.eventVersion', () => {
    const pre = room();
    const post = room({
      eventVersion: 1,
      members: [
        ...pre.members,
        { id: 'p1', handle: '@guest', joinToken: 'jt-1', joinedAt: 0, status: 'connected' },
      ],
    });
    const events = deriveRoomJoined({ preState: pre, postState: post });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('room_joined');
    expect(events[0]?.version).toBe(1);
    if (events[0]?.type === 'room_joined') {
      expect(events[0].player.id).toBe('p1');
      expect(events[0].player.handle).toBe('@guest');
      expect(events[0].player.team).toBe('t2'); // index 1 → t2
      expect(events[0].player.handCount).toBe(0);
      expect(events[0].player.rank).toBeNull();
    }
  });

  it('alternates team by index — p0 t1, p1 t2, p2 t1, p3 t2', () => {
    const pre = room({
      members: [
        room().members[0]!,
        { id: 'p1', handle: '@b', joinToken: 'jt-1', joinedAt: 0, status: 'connected' },
        { id: 'p2', handle: '@c', joinToken: 'jt-2', joinedAt: 0, status: 'connected' },
      ],
    });
    const post = room({
      eventVersion: 3,
      members: [
        ...pre.members,
        { id: 'p3', handle: '@d', joinToken: 'jt-3', joinedAt: 0, status: 'connected' },
      ],
    });
    const events = deriveRoomJoined({ preState: pre, postState: post });
    if (events[0]?.type === 'room_joined') {
      expect(events[0].player.team).toBe('t2'); // index 3 → t2
    }
  });
});

describe('deriveRoomLeft', () => {
  it('returns [] when no member left', () => {
    const pre = room();
    expect(
      deriveRoomLeft({ preState: pre, postState: pre, reason: 'leave' })
    ).toEqual([]);
  });

  it('emits room_left for a removed member with reason + correct version', () => {
    const pre = room({
      members: [
        room().members[0]!,
        { id: 'p1', handle: '@guest', joinToken: 'jt-1', joinedAt: 0, status: 'connected' },
      ],
      eventVersion: 1,
    });
    const post = room({
      members: [room().members[0]!],
      eventVersion: 2,
    });
    const events = deriveRoomLeft({
      preState: pre,
      postState: post,
      reason: 'leave',
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('room_left');
    expect(events[0]?.version).toBe(2);
    if (events[0]?.type === 'room_left') {
      expect(events[0].playerId).toBe('p1');
      expect(events[0].reason).toBe('leave');
    }
  });

  it('passes through reason variants', () => {
    const pre = room({
      members: [
        room().members[0]!,
        { id: 'p1', handle: '@guest', joinToken: 'jt-1', joinedAt: 0, status: 'connected' },
      ],
      eventVersion: 1,
    });
    const post = room({
      members: [room().members[0]!],
      eventVersion: 2,
    });
    for (const reason of ['leave', 'disconnect', 'kick'] as const) {
      const events = deriveRoomLeft({ preState: pre, postState: post, reason });
      if (events[0]?.type === 'room_left') {
        expect(events[0].reason).toBe(reason);
      }
    }
  });
});
