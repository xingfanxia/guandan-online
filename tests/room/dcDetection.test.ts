// Behavior tests for AI-4 disconnect detection (markSeen + findDisconnectedHumans).

import { describe, expect, it } from 'vitest';
import { markSeen, findDisconnectedHumans } from '@lib/room/dcDetection';
import type { RoomState, RoomMember } from '@lib/room/lifecycle';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

const NOW = 1_700_000_000_000;
const THRESHOLD = 60_000; // 60s

function member(overrides: Partial<RoomMember> & { id: string }): RoomMember {
  return {
    handle: `@${overrides.id}`,
    joinToken: `jt-${overrides.id}`,
    joinedAt: NOW,
    status: 'connected',
    ...overrides,
  };
}

function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'AAA111',
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    hostId: 'p0',
    hostToken: 'ht',
    members: [member({ id: 'p0' })],
    phase: 'in_game',
    createdAt: NOW,
    lastActiveAt: NOW,
    eventVersion: 0,
    ...overrides,
  };
}

describe('markSeen', () => {
  it('sets lastSeenAt[playerId] without mutating the input state', () => {
    const before = room();
    const after = markSeen(before, 'p0', NOW + 5_000);

    expect(after.lastSeenAt).toEqual({ p0: NOW + 5_000 });
    // Immutability: original untouched, fresh object returned.
    expect(before.lastSeenAt).toBeUndefined();
    expect(after).not.toBe(before);
  });

  it('merges into an existing lastSeenAt map (preserves other players)', () => {
    const before = room({ lastSeenAt: { p0: NOW, p1: NOW } });
    const after = markSeen(before, 'p1', NOW + 10_000);

    expect(after.lastSeenAt).toEqual({ p0: NOW, p1: NOW + 10_000 });
    // Original map object is not mutated.
    expect(before.lastSeenAt).toEqual({ p0: NOW, p1: NOW });
    expect(after.lastSeenAt).not.toBe(before.lastSeenAt);
  });
});

describe('findDisconnectedHumans', () => {
  it('returns connected humans whose lastSeenAt is past the threshold', () => {
    const state = room({
      members: [
        member({ id: 'p0' }),
        member({ id: 'p1' }),
        member({ id: 'p2' }),
      ],
      lastSeenAt: {
        p0: NOW, // just seen → live
        p1: NOW - THRESHOLD - 1, // silent past threshold → disconnected
        p2: NOW - 10_000, // 10s ago → still live
      },
    });
    expect(findDisconnectedHumans(state, NOW, THRESHOLD)).toEqual(['p1']);
  });

  it('falls back to joinedAt when lastSeenAt has no entry for the member', () => {
    const state = room({
      members: [
        member({ id: 'p0', joinedAt: NOW }), // joined now → live
        member({ id: 'p1', joinedAt: NOW - THRESHOLD - 1 }), // joined long ago, never seen → disconnected
      ],
      // no lastSeenAt map at all
    });
    expect(findDisconnectedHumans(state, NOW, THRESHOLD)).toEqual(['p1']);
  });

  it('ignores bots even when they are stale', () => {
    const state = room({
      members: [
        member({ id: 'p0' }),
        member({ id: 'bot1', status: 'bot', difficulty: 'medium' }),
      ],
      lastSeenAt: {
        p0: NOW,
        bot1: NOW - 10 * 60 * 1000, // bots never bump lastSeenAt → ancient
      },
    });
    expect(findDisconnectedHumans(state, NOW, THRESHOLD)).toEqual([]);
  });

  it('ignores already-disconnected members (only connected humans are returned)', () => {
    const state = room({
      members: [
        member({ id: 'p0' }),
        member({ id: 'p1', status: 'disconnected' }),
      ],
      lastSeenAt: { p0: NOW, p1: NOW - THRESHOLD - 1 },
    });
    expect(findDisconnectedHumans(state, NOW, THRESHOLD)).toEqual([]);
  });

  it('returns [] when the room is in lobby (only in-game rooms are swept)', () => {
    const state = room({
      phase: 'lobby',
      members: [member({ id: 'p0', joinedAt: NOW - THRESHOLD - 1 })],
    });
    expect(findDisconnectedHumans(state, NOW, THRESHOLD)).toEqual([]);
  });

  it('respects the threshold boundary (exactly threshold ago is NOT disconnected)', () => {
    const state = room({
      members: [member({ id: 'p0' }), member({ id: 'p1' })],
      lastSeenAt: {
        p0: NOW - THRESHOLD, // exactly threshold → cutoff is NOW-THRESHOLD; not < cutoff → live
        p1: NOW - THRESHOLD - 1, // one ms over → disconnected
      },
    });
    expect(findDisconnectedHumans(state, NOW, THRESHOLD)).toEqual(['p1']);
  });

  it('returns multiple disconnected humans', () => {
    const state = room({
      members: [
        member({ id: 'p0' }),
        member({ id: 'p1' }),
        member({ id: 'p2' }),
        member({ id: 'p3' }),
      ],
      lastSeenAt: {
        p0: NOW,
        p1: NOW - THRESHOLD - 100,
        p2: NOW - THRESHOLD - 100,
        p3: NOW,
      },
    });
    expect(findDisconnectedHumans(state, NOW, THRESHOLD).sort()).toEqual([
      'p1',
      'p2',
    ]);
  });
});
