import { describe, expect, it } from 'vitest';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  isStale,
} from '@lib/room/lifecycle';
import type { RoomState } from '@lib/room/lifecycle';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

const tokenGen = () => {
  let i = 0;
  return () => `tok-${++i}`;
};

// ─── createRoom ───────────────────────────────────────────────────────────────

describe('createRoom', () => {
  it('builds initial state with host as the first member', () => {
    const r = createRoom({
      code: 'A2B3C4',
      mode: '4',
      rules: DEFAULT_MODE_RULES,
      host: { id: 'alice', handle: '@alice' },
      now: T0,
      tokenGen: tokenGen(),
    });
    expect(r.code).toBe('A2B3C4');
    expect(r.hostId).toBe('alice');
    expect(r.members).toHaveLength(1);
    expect(r.members[0]?.id).toBe('alice');
    expect(r.members[0]?.handle).toBe('@alice');
    expect(r.members[0]?.status).toBe('connected');
    expect(r.phase).toBe('lobby');
    expect(r.createdAt).toBe(T0);
    expect(r.lastActiveAt).toBe(T0);
  });

  it('host token is distinct from the host\'s join token', () => {
    const r = createRoom({
      code: 'A2B3C4',
      mode: '4',
      rules: DEFAULT_MODE_RULES,
      host: { id: 'alice', handle: '@alice' },
      now: T0,
      tokenGen: tokenGen(),
    });
    expect(r.hostToken).not.toBe(r.members[0]?.joinToken);
    expect(r.hostToken).toBeTruthy();
    expect(r.members[0]?.joinToken).toBeTruthy();
  });
});

// ─── joinRoom ─────────────────────────────────────────────────────────────────

describe('joinRoom', () => {
  function freshRoom(mode: '4' | '6' | '8' = '4'): RoomState {
    return createRoom({
      code: 'A2B3C4',
      mode,
      rules: DEFAULT_MODE_RULES,
      host: { id: 'alice', handle: '@alice' },
      now: T0,
      tokenGen: tokenGen(),
    });
  }

  it('adds a member and bumps lastActiveAt', () => {
    const r0 = freshRoom();
    const r1 = joinRoom(r0, { id: 'bob', handle: '@bob' }, T0 + 1000, tokenGen());
    expect(r1.members).toHaveLength(2);
    expect(r1.members[1]?.id).toBe('bob');
    expect(r1.lastActiveAt).toBe(T0 + 1000);
  });

  it('rejects when room is full (4 in 4P mode)', () => {
    let r = freshRoom('4');
    r = joinRoom(r, { id: 'bob', handle: '@bob' }, T0, tokenGen());
    r = joinRoom(r, { id: 'carol', handle: '@carol' }, T0, tokenGen());
    r = joinRoom(r, { id: 'dave', handle: '@dave' }, T0, tokenGen());
    // 5th join should throw
    expect(() => joinRoom(r, { id: 'eve', handle: '@eve' }, T0, tokenGen())).toThrow(/full/i);
  });

  it('6P fits 6 members', () => {
    let r = freshRoom('6');
    for (const id of ['b', 'c', 'd', 'e', 'f']) {
      r = joinRoom(r, { id, handle: `@${id}` }, T0, tokenGen());
    }
    expect(r.members).toHaveLength(6);
  });

  it('8P fits 8 members', () => {
    let r = freshRoom('8');
    for (const id of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      r = joinRoom(r, { id, handle: `@${id}` }, T0, tokenGen());
    }
    expect(r.members).toHaveLength(8);
  });

  it('rejects duplicate handle (case-sensitive)', () => {
    let r = freshRoom();
    r = joinRoom(r, { id: 'bob', handle: '@bob' }, T0, tokenGen());
    expect(() =>
      joinRoom(r, { id: 'bob2', handle: '@bob' }, T0, tokenGen())
    ).toThrow(/handle|already/i);
  });

  it('rejects join after game has started (room in "in_game" phase)', () => {
    const r0 = freshRoom();
    const inGame: RoomState = { ...r0, phase: 'in_game' };
    expect(() =>
      joinRoom(inGame, { id: 'bob', handle: '@bob' }, T0, tokenGen())
    ).toThrow(/lobby|in_game|started/i);
  });
});

// ─── leaveRoom ────────────────────────────────────────────────────────────────

describe('leaveRoom', () => {
  function room2(): RoomState {
    let r = createRoom({
      code: 'A2B3C4',
      mode: '4',
      rules: DEFAULT_MODE_RULES,
      host: { id: 'alice', handle: '@alice' },
      now: T0,
      tokenGen: tokenGen(),
    });
    r = joinRoom(r, { id: 'bob', handle: '@bob' }, T0, tokenGen());
    return r;
  }

  it('non-host leave removes member, room continues', () => {
    const r1 = leaveRoom(room2(), 'bob', T0 + 1000);
    expect(r1).not.toBeNull();
    expect(r1!.members.map((m) => m.id)).toEqual(['alice']);
    expect(r1!.lastActiveAt).toBe(T0 + 1000);
  });

  it('host leave dissolves the room (returns null)', () => {
    const r1 = leaveRoom(room2(), 'alice', T0 + 1000);
    expect(r1).toBeNull();
  });

  it('non-existent player leave is a no-op (returns state unchanged)', () => {
    const before = room2();
    const r1 = leaveRoom(before, 'ghost', T0 + 1000);
    expect(r1?.members.length).toBe(before.members.length);
  });
});

// ─── isStale ──────────────────────────────────────────────────────────────────

describe('isStale', () => {
  it('returns true when lastActiveAt + ttl ≤ now', () => {
    const r: RoomState = {
      ...createRoom({
        code: 'A2B3C4',
        mode: '4',
        rules: DEFAULT_MODE_RULES,
        host: { id: 'alice', handle: '@alice' },
        now: T0,
        tokenGen: tokenGen(),
      }),
    };
    expect(isStale(r, T0 + HOUR, HOUR)).toBe(true); // exactly at TTL boundary
    expect(isStale(r, T0 + HOUR + 1, HOUR)).toBe(true);
  });

  it('returns false while within TTL', () => {
    const r: RoomState = {
      ...createRoom({
        code: 'A2B3C4',
        mode: '4',
        rules: DEFAULT_MODE_RULES,
        host: { id: 'alice', handle: '@alice' },
        now: T0,
        tokenGen: tokenGen(),
      }),
    };
    expect(isStale(r, T0 + HOUR - 1, HOUR)).toBe(false);
  });
});
