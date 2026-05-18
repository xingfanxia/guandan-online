import { describe, it, expect, vi } from 'vitest';
import seedrandom from 'seedrandom';
import { runBots } from '@lib/ai/runBots';
import type { RoomState, RoomMember } from '@lib/room/lifecycle';
import { dealRound, startTrick } from '@lib/game/round';
import type { PlayerSeat } from '@lib/game/round';
import { buildDeck, shuffleDeck } from '@lib/game/cards';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

const SEATS_4P: PlayerSeat[] = [
  { id: 'p0', team: 't1', position: 0 },
  { id: 'p1', team: 't2', position: 1 },
  { id: 'p2', team: 't1', position: 2 },
  { id: 'p3', team: 't2', position: 3 },
];

function makeMember(
  id: string,
  status: 'connected' | 'bot',
  difficulty?: 'easy' | 'medium' | 'hard'
): RoomMember {
  const base: RoomMember = {
    id,
    handle: `@${id}`,
    joinToken: `tok-${id}`,
    joinedAt: 0,
    status,
  };
  if (difficulty !== undefined) base.difficulty = difficulty;
  return base;
}

function makeRoom(members: RoomMember[]): RoomState {
  return {
    code: 'TEST01',
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    hostId: members[0]!.id,
    hostToken: 'host-tok',
    members,
    phase: 'in_game',
    createdAt: 0,
    lastActiveAt: 0,
    eventVersion: 1,
  };
}

function freshRound() {
  const rng = seedrandom('runBots-1');
  const deck = shuffleDeck(buildDeck(), rng);
  return startTrick(
    dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'p0',
      shuffledDeck: deck,
    })
  );
}

describe('runBots', () => {
  it('returns early when current player is human (no events)', () => {
    const round = freshRound();
    // Current player p0 is human.
    const room = makeRoom([
      makeMember('p0', 'connected'),
      makeMember('p1', 'bot', 'easy'),
      makeMember('p2', 'connected'),
      makeMember('p3', 'bot', 'easy'),
    ]);
    const result = runBots({
      room,
      round,
      startVersion: 1,
      turnDeadline: '2026-05-18T00:00:00.000Z',
    });
    expect(result.events).toHaveLength(0);
    expect(result.round).toBe(round);
    expect(result.version).toBe(1);
  });

  it('runs a single bot turn when next player is a bot', () => {
    // Force p1 to be the current player by simulating that p0 already played
    // (we just run the loop starting on p1's turn). Easiest: rotate seats so
    // p0 starts as leader, then we replace the room so p0 is bot/p1+ human.
    const room = makeRoom([
      makeMember('p0', 'bot', 'easy'),
      makeMember('p1', 'connected'),
      makeMember('p2', 'bot', 'easy'),
      makeMember('p3', 'connected'),
    ]);
    const round = freshRound();
    const result = runBots({
      room,
      round,
      startVersion: 1,
      turnDeadline: '2026-05-18T00:00:00.000Z',
    });
    // p0 (bot) is leader-of-empty-trick — bots can't pass on open, so a play
    // is emitted. Then p1 (human) is up, so we stop.
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(result.events[0]!.type).toBe('move_played');
    // After p0 plays, the round's currentTrick.currentPlayer should be p1.
    expect(result.round.currentTrick?.currentPlayer).toBe('p1');
  });

  it('plays a full round when all 4 players are bots', () => {
    const room = makeRoom([
      makeMember('p0', 'bot', 'easy'),
      makeMember('p1', 'bot', 'easy'),
      makeMember('p2', 'bot', 'easy'),
      makeMember('p3', 'bot', 'easy'),
    ]);
    const round = freshRound();
    const result = runBots({
      room,
      round,
      startVersion: 1,
      turnDeadline: '2026-05-18T00:00:00.000Z',
      maxIterations: 5000,
    });
    expect(result.round.phase).toBe('finished');
    expect(result.events.length).toBeGreaterThan(10);
    // Versions are monotonic and contiguous starting from 2.
    for (let i = 0; i < result.events.length; i++) {
      expect(result.events[i]!.version).toBe(2 + i);
    }
    expect(result.version).toBe(result.events[result.events.length - 1]!.version);
  });

  it('emits trick_won at end-of-trick alongside the closing move event', () => {
    const room = makeRoom([
      makeMember('p0', 'bot', 'easy'),
      makeMember('p1', 'bot', 'easy'),
      makeMember('p2', 'bot', 'easy'),
      makeMember('p3', 'bot', 'easy'),
    ]);
    const round = freshRound();
    const result = runBots({
      room,
      round,
      startVersion: 1,
      turnDeadline: '2026-05-18T00:00:00.000Z',
      maxIterations: 5000,
    });
    // Trick_won events should be present once at least one trick completed.
    const trickWonEvents = result.events.filter((e) => e.type === 'trick_won');
    expect(trickWonEvents.length).toBeGreaterThan(0);
  });

  it('falls back to medium when tier=hard (synchronous path)', () => {
    const room = makeRoom([
      makeMember('p0', 'bot', 'hard'),
      makeMember('p1', 'connected'),
      makeMember('p2', 'bot', 'easy'),
      makeMember('p3', 'connected'),
    ]);
    const round = freshRound();
    // Should not throw — runBots maps 'hard' → medium internally so the
    // synchronous run-loop stays valid until AI-2 wires the async client.
    const result = runBots({
      room,
      round,
      startVersion: 1,
      turnDeadline: '2026-05-18T00:00:00.000Z',
    });
    expect(result.events.length).toBeGreaterThanOrEqual(1);
  });

  it('handles between-trick gap by auto-starting next trick', () => {
    const room = makeRoom([
      makeMember('p0', 'connected'),
      makeMember('p1', 'connected'),
      makeMember('p2', 'connected'),
      makeMember('p3', 'connected'),
    ]);
    let round = freshRound();
    // Simulate a between-trick state where the prior trick just ended.
    round = { ...round, currentTrick: null };
    const result = runBots({
      room,
      round,
      startVersion: 1,
      turnDeadline: '2026-05-18T00:00:00.000Z',
    });
    // currentTrick should now be non-null (startTrick was called), but no
    // events emitted because the leader (a human) takes the turn.
    expect(result.round.currentTrick).not.toBeNull();
    expect(result.events).toHaveLength(0);
  });

  it('stops on max iterations safety cap', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const room = makeRoom([
      makeMember('p0', 'bot', 'easy'),
      makeMember('p1', 'bot', 'easy'),
      makeMember('p2', 'bot', 'easy'),
      makeMember('p3', 'bot', 'easy'),
    ]);
    const round = freshRound();
    const result = runBots({
      room,
      round,
      startVersion: 1,
      turnDeadline: '2026-05-18T00:00:00.000Z',
      maxIterations: 3,
    });
    expect(result.events.length).toBeLessThanOrEqual(6); // each iter can emit up to 2 events
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('orphan currentPlayer (no member record) bails out cleanly', () => {
    const room = makeRoom([
      makeMember('p1', 'bot', 'easy'),
      makeMember('p2', 'connected'),
      makeMember('p3', 'connected'),
      // p0 missing
    ]);
    const round = freshRound(); // currentPlayer is p0
    const result = runBots({
      room,
      round,
      startVersion: 1,
      turnDeadline: '2026-05-18T00:00:00.000Z',
    });
    expect(result.events).toHaveLength(0);
    expect(result.round).toBe(round);
  });
});
