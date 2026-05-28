// Behavior tests for AI-4 bot takeover + reclaim (promoteToBot + reclaimSeat).

import { describe, expect, it } from 'vitest';
import { promoteToBot, reclaimSeat } from '@lib/room/botTakeover';
import type { RoomState, RoomMember } from '@lib/room/lifecycle';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

const NOW = 1_700_000_000_000;

function member(overrides: Partial<RoomMember> & { id: string }): RoomMember {
  return {
    handle: `@${overrides.id}`,
    joinToken: `jt-${overrides.id}`,
    joinedAt: NOW,
    status: 'connected',
    ...overrides,
  };
}

function room(members: RoomMember[]): RoomState {
  return {
    code: 'AAA111',
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    hostId: 'p0',
    hostToken: 'ht',
    members,
    phase: 'in_game',
    createdAt: NOW,
    lastActiveAt: NOW,
    eventVersion: 0,
  };
}

describe('promoteToBot', () => {
  it('flips a connected human to a bot, stashing reclaim credentials', () => {
    const before = room([member({ id: 'p0' }), member({ id: 'p1' })]);
    const after = promoteToBot(before, 'p1', 'medium');

    const m = after.members.find((x) => x.id === 'p1')!;
    expect(m.status).toBe('bot');
    expect(m.difficulty).toBe('medium');
    expect(m.takenOverFrom).toEqual({ handle: '@p1', joinToken: 'jt-p1' });
    // Hand/seat live in the round, not here — member id is unchanged.
    expect(m.id).toBe('p1');
  });

  it('defaults to medium difficulty', () => {
    const before = room([member({ id: 'p0' }), member({ id: 'p1' })]);
    const after = promoteToBot(before, 'p1');
    expect(after.members.find((x) => x.id === 'p1')!.difficulty).toBe('medium');
  });

  it('honors an easy takeover tier', () => {
    const before = room([member({ id: 'p0' }), member({ id: 'p1' })]);
    const after = promoteToBot(before, 'p1', 'easy');
    expect(after.members.find((x) => x.id === 'p1')!.difficulty).toBe('easy');
  });

  it('does not mutate the input state or members array', () => {
    const before = room([member({ id: 'p0' }), member({ id: 'p1' })]);
    const after = promoteToBot(before, 'p1');

    expect(before.members.find((x) => x.id === 'p1')!.status).toBe('connected');
    expect(after).not.toBe(before);
    expect(after.members).not.toBe(before.members);
  });

  it('is a no-op when the player is not found', () => {
    const before = room([member({ id: 'p0' })]);
    const after = promoteToBot(before, 'ghost');
    expect(after).toBe(before);
  });

  it('is idempotent — re-promoting an already-bot seat keeps the original takenOverFrom', () => {
    const before = room([member({ id: 'p0' }), member({ id: 'p1' })]);
    const once = promoteToBot(before, 'p1', 'medium');
    // A second sweep tick that re-flags the same seat must NOT clobber the
    // stashed human credentials with the bot's own (now identical) fields.
    const twice = promoteToBot(once, 'p1', 'easy');

    const m = twice.members.find((x) => x.id === 'p1')!;
    expect(m.takenOverFrom).toEqual({ handle: '@p1', joinToken: 'jt-p1' });
    expect(m.difficulty).toBe('medium'); // not overwritten by the second 'easy' call
    expect(twice).toBe(once); // no-op returns the same reference
  });

  it('does not flag a genuine host-fill bot as a takeover', () => {
    const before = room([
      member({ id: 'p0' }),
      member({ id: 'bot1', status: 'bot', difficulty: 'easy' }),
    ]);
    const after = promoteToBot(before, 'bot1');
    // Genuine bots are already 'bot' → no-op, no takenOverFrom added.
    expect(after).toBe(before);
    expect(after.members.find((x) => x.id === 'bot1')!.takenOverFrom).toBeUndefined();
  });
});

describe('reclaimSeat', () => {
  it('flips a takeover-bot back to a connected human with the matching token', () => {
    const promoted = promoteToBot(
      room([member({ id: 'p0' }), member({ id: 'p1' })]),
      'p1'
    );
    const { state, reclaimed } = reclaimSeat(promoted, 'p1', 'jt-p1');

    expect(reclaimed).toBe(true);
    const m = state.members.find((x) => x.id === 'p1')!;
    expect(m.status).toBe('connected');
    expect(m.handle).toBe('@p1');
    expect(m.joinToken).toBe('jt-p1');
    expect(m.difficulty).toBeUndefined();
    expect(m.takenOverFrom).toBeUndefined();
  });

  it('fails with a wrong token and leaves the state unchanged', () => {
    const promoted = promoteToBot(
      room([member({ id: 'p0' }), member({ id: 'p1' })]),
      'p1'
    );
    const { state, reclaimed } = reclaimSeat(promoted, 'p1', 'wrong-token');

    expect(reclaimed).toBe(false);
    expect(state).toBe(promoted);
    expect(state.members.find((x) => x.id === 'p1')!.status).toBe('bot');
  });

  it('does not mutate the input state on success', () => {
    const promoted = promoteToBot(
      room([member({ id: 'p0' }), member({ id: 'p1' })]),
      'p1'
    );
    const { state } = reclaimSeat(promoted, 'p1', 'jt-p1');
    // Original promoted state still shows the bot.
    expect(promoted.members.find((x) => x.id === 'p1')!.status).toBe('bot');
    expect(state).not.toBe(promoted);
  });

  it('refuses to reclaim a genuine host-fill bot (no takenOverFrom)', () => {
    const state = room([
      member({ id: 'p0' }),
      member({ id: 'bot1', status: 'bot', difficulty: 'medium', joinToken: 'jt-bot1' }),
    ]);
    // Even presenting the bot's own joinToken must not reclaim — there is no
    // human behind a host-fill bot.
    const result = reclaimSeat(state, 'bot1', 'jt-bot1');
    expect(result.reclaimed).toBe(false);
    expect(result.state).toBe(state);
  });

  it('fails when the player is not found', () => {
    const state = room([member({ id: 'p0' })]);
    const result = reclaimSeat(state, 'ghost', 'any');
    expect(result.reclaimed).toBe(false);
    expect(result.state).toBe(state);
  });

  it('fails on a live human (nothing to reclaim)', () => {
    const state = room([member({ id: 'p0' }), member({ id: 'p1' })]);
    const result = reclaimSeat(state, 'p1', 'jt-p1');
    expect(result.reclaimed).toBe(false);
    expect(result.state).toBe(state);
  });

  it('preserves an ipHash across the takeover → reclaim round-trip', () => {
    const promoted = promoteToBot(
      room([member({ id: 'p0' }), member({ id: 'p1', ipHash: 'hash-xyz' })]),
      'p1'
    );
    const { state, reclaimed } = reclaimSeat(promoted, 'p1', 'jt-p1');
    expect(reclaimed).toBe(true);
    expect(state.members.find((x) => x.id === 'p1')!.ipHash).toBe('hash-xyz');
  });
});
