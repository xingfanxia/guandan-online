// Behavior tests for buildGameState — bridges RoomState + GameRound → the
// authoritative server-side GameState that drives publishEvent.

import { describe, expect, it } from 'vitest';
import { buildGameState } from '@lib/realtime/buildGameState';
import { dealRound, startTrick } from '@lib/game/round';
import type { GameRound, PlayerSeat } from '@lib/game/round';
import { buildDeck, shuffleDeck } from '@lib/game/cards';
import type { RoomState } from '@lib/room/lifecycle';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';
import seedrandom from 'seedrandom';

function buildRound(): GameRound {
  const seats: readonly PlayerSeat[] = [
    { id: 'p0', team: 't1', position: 0 },
    { id: 'p1', team: 't2', position: 1 },
    { id: 'p2', team: 't1', position: 2 },
    { id: 'p3', team: 't2', position: 3 },
  ];
  const rng = seedrandom('build-game-state-test');
  const shuffled = shuffleDeck(buildDeck(), () => rng());
  return startTrick(
    dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats,
      leader: 'p0',
      shuffledDeck: shuffled,
    })
  );
}

function buildRoom(): RoomState {
  return {
    code: 'A2B3C4',
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    hostId: 'p0',
    hostToken: 'ht',
    members: [
      { id: 'p0', handle: 'host', joinToken: 'jt0', joinedAt: 0, status: 'connected' },
      { id: 'p1', handle: 'one', joinToken: 'jt1', joinedAt: 0, status: 'connected' },
      { id: 'p2', handle: 'two', joinToken: 'jt2', joinedAt: 0, status: 'connected' },
      { id: 'p3', handle: 'three', joinToken: 'jt3', joinedAt: 0, status: 'bot' },
    ],
    phase: 'in_game',
    createdAt: 0,
    lastActiveAt: 0,
    eventVersion: 0,
  };
}

describe('buildGameState — hands', () => {
  it('encodes Card[] hands into CardId[] for every seated player', () => {
    const state = buildGameState(buildRoom(), buildRound());
    expect(Object.keys(state.hands).sort()).toEqual(['p0', 'p1', 'p2', 'p3']);
    for (const hand of Object.values(state.hands)) {
      // 108 cards / 4 players = 27 each
      expect(hand).toHaveLength(27);
      // CardId format <rank>-<suit-letter>-<deck>
      expect(hand[0]).toMatch(/^[A-Za-z0-9]+-[A-Z]+-[12]$/);
    }
  });
});

describe('buildGameState — handles + statuses', () => {
  it('maps member handles and statuses by playerId', () => {
    const state = buildGameState(buildRoom(), buildRound());
    expect(state.handles).toEqual({
      p0: 'host',
      p1: 'one',
      p2: 'two',
      p3: 'three',
    });
    expect(state.statuses).toEqual({
      p0: 'connected',
      p1: 'connected',
      p2: 'connected',
      p3: 'bot',
    });
  });
});

describe('buildGameState — teams + partners', () => {
  it('maps each seat to its team', () => {
    const state = buildGameState(buildRoom(), buildRound());
    expect(state.teams).toEqual({ p0: 't1', p1: 't2', p2: 't1', p3: 't2' });
  });

  it('pairs each player with their first teammate by position', () => {
    const state = buildGameState(buildRoom(), buildRound());
    // Team t1: p0, p2 → partners[p0]=p2, partners[p2]=p0
    // Team t2: p1, p3 → partners[p1]=p3, partners[p3]=p1
    expect(state.partners.p0).toBe('p2');
    expect(state.partners.p2).toBe('p0');
    expect(state.partners.p1).toBe('p3');
    expect(state.partners.p3).toBe('p1');
  });
});

describe('buildGameState — ranks', () => {
  it('returns null for every seat when finishOrder is empty', () => {
    const state = buildGameState(buildRoom(), buildRound());
    expect(state.ranks).toEqual({ p0: null, p1: null, p2: null, p3: null });
  });

  it('assigns 1-based ranks per finishOrder', () => {
    const round = { ...buildRound(), finishOrder: ['p2', 'p0'] };
    const state = buildGameState(buildRoom(), round);
    expect(state.ranks.p2).toBe(1);
    expect(state.ranks.p0).toBe(2);
    expect(state.ranks.p1).toBeNull();
    expect(state.ranks.p3).toBeNull();
  });
});
