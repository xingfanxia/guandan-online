// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { reduceEvent } from '@/screens/GameTableMP';
import type { ServerEvent, PlayerSummary } from '@lib/realtime/messages';

const PLAYERS_6P: PlayerSummary[] = [
  { id: 'p0', handle: '@阿祥', team: 't1', handCount: 27, status: 'connected', rank: null },
  { id: 'p1', handle: '@饭团', team: 't2', handCount: 27, status: 'connected', rank: null },
  { id: 'p2', handle: '@老郭', team: 't1', handCount: 27, status: 'connected', rank: null },
  { id: 'p3', handle: '@豆豆', team: 't2', handCount: 27, status: 'bot', rank: null },
  { id: 'p4', handle: '@毛毛', team: 't1', handCount: 27, status: 'connected', rank: null },
  { id: 'p5', handle: '@王王', team: 't2', handCount: 27, status: 'connected', rank: null },
];

const EMPTY = {
  myHand: [],
  players: new Map(),
  seatOrder: [],
  teamLevels: { t1: '2' as const, t2: '2' as const },
  currentTurn: null,
  lastPlayed: null,
  myPlayerId: null,
  myTeam: null,
};

describe('GameTableMP reducer', () => {
  it('snapshot populates seatOrder + players + my identity', () => {
    const snap: ServerEvent = {
      type: 'snapshot',
      version: 1,
      players: PLAYERS_6P,
      table: {
        teamLevels: { t1: '5', t2: '4' },
        currentTurn: 'p0',
        roundOwner: 't1',
        levelRank: '5',
        roundNumber: 1,
      },
      you: {
        playerId: 'p0',
        teamId: 't1',
        partnerId: 'p2',
        hand: [],
        rank: null,
      },
    } as ServerEvent;
    const result = reduceEvent(EMPTY as Parameters<typeof reduceEvent>[0], snap, '@阿祥');
    expect(result.seatOrder).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
    expect(result.myPlayerId).toBe('p0');
    expect(result.myTeam).toBe('t1');
    expect(result.teamLevels).toEqual({ t1: '5', t2: '4' });
    expect(result.currentTurn).toBe('p0');
  });

  it('move_played updates currentTurn + last-played + decrements author handCount', () => {
    const seeded = {
      ...EMPTY,
      players: new Map(PLAYERS_6P.map((p) => [p.id, p])),
      seatOrder: PLAYERS_6P.map((p) => p.id),
      myPlayerId: 'p0',
      myTeam: 't1' as const,
    };
    const evt: ServerEvent = {
      type: 'move_played',
      version: 5,
      player: 'p1',
      cards: ['5-S-1'],
      combinationLabel: 'single',
      nextTurn: 'p2',
      turnDeadline: '2026-05-18T01:00:00.000Z',
    } as ServerEvent;
    const result = reduceEvent(seeded as Parameters<typeof reduceEvent>[0], evt, '@阿祥');
    expect(result.currentTurn).toBe('p2');
    expect(result.lastPlayed?.combinationLabel).toBe('single');
    expect(result.lastPlayed?.player).toBe('@饭团');
    expect(result.players.get('p1')?.handCount).toBe(26);
  });

  it('move_passed only updates currentTurn', () => {
    const seeded = {
      ...EMPTY,
      players: new Map(PLAYERS_6P.map((p) => [p.id, p])),
      seatOrder: PLAYERS_6P.map((p) => p.id),
      currentTurn: 'p1',
      lastPlayed: null,
    };
    const evt: ServerEvent = {
      type: 'move_passed',
      version: 6,
      player: 'p1',
      nextTurn: 'p2',
      turnDeadline: '2026-05-18T01:00:01.000Z',
    } as ServerEvent;
    const result = reduceEvent(seeded as Parameters<typeof reduceEvent>[0], evt, '@阿祥');
    expect(result.currentTurn).toBe('p2');
    expect(result.lastPlayed).toBeNull();
  });

  it('trick_won clears lastPlayed + sets currentTurn to nextLeader', () => {
    const seeded = {
      ...EMPTY,
      lastPlayed: { player: '@饭团', cards: [], combinationLabel: 'single' },
      currentTurn: 'p1',
    };
    const evt: ServerEvent = {
      type: 'trick_won',
      version: 7,
      winner: 'p1',
      nextLeader: 'p1',
    } as ServerEvent;
    const result = reduceEvent(seeded as Parameters<typeof reduceEvent>[0], evt, '@阿祥');
    expect(result.currentTurn).toBe('p1');
    expect(result.lastPlayed).toBeNull();
  });

  it('room_joined appends to seatOrder', () => {
    const seeded = {
      ...EMPTY,
      players: new Map(PLAYERS_6P.slice(0, 3).map((p) => [p.id, p])),
      seatOrder: ['p0', 'p1', 'p2'],
    };
    const evt: ServerEvent = {
      type: 'room_joined',
      version: 2,
      player: PLAYERS_6P[3]!,
    } as ServerEvent;
    const result = reduceEvent(seeded as Parameters<typeof reduceEvent>[0], evt, '@阿祥');
    expect(result.seatOrder).toContain('p3');
    expect(result.players.get('p3')?.handle).toBe('@豆豆');
  });

  it('room_left removes the player from seatOrder + players map', () => {
    const seeded = {
      ...EMPTY,
      players: new Map(PLAYERS_6P.map((p) => [p.id, p])),
      seatOrder: PLAYERS_6P.map((p) => p.id),
    };
    const evt: ServerEvent = {
      type: 'room_left',
      version: 3,
      playerId: 'p3',
      reason: 'leave',
    } as ServerEvent;
    const result = reduceEvent(seeded as Parameters<typeof reduceEvent>[0], evt, '@阿祥');
    expect(result.seatOrder).not.toContain('p3');
    expect(result.players.has('p3')).toBe(false);
  });

  it('unknown event types pass through unchanged', () => {
    const evt = { type: 'state_resync', version: 99 } as unknown as ServerEvent;
    expect(reduceEvent(EMPTY as Parameters<typeof reduceEvent>[0], evt, '@阿祥')).toEqual(EMPTY);
  });
});
