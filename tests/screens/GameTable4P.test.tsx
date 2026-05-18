// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { reduceEvent, splitSeats } from '@/screens/GameTable4P';
import type {
  DealEvent,
  MovePlayedEvent,
  MovePassedEvent,
  PlayerSummary,
  RoomJoinedEvent,
  RoomLeftEvent,
  SnapshotEvent,
  TrickWonEvent,
} from '@lib/realtime/messages';
import type { Card as GameCard } from '@lib/game/cards';

const EMPTY = {
  myHand: [] as GameCard[],
  players: new Map<string, PlayerSummary>(),
  teamLevels: { t1: '2', t2: '2' },
  currentTurn: null,
  lastPlayed: null,
  myPlayerId: null,
  myTeam: null,
  partnerId: null,
} as const;

const snapshot: SnapshotEvent = {
  type: 'snapshot',
  version: 1,
  you: {
    playerId: 'p_me',
    hand: ['A-H-1', '5-S-2'],
    teamId: 't1',
    partnerId: 'p_partner',
  },
  table: {
    currentTurn: 'p_me',
    currentTrick: [],
    lastTrick: null,
    teamLevels: { t1: '5', t2: '6' },
    roundOwner: 't1',
    phase: 'playing',
    turnDeadline: '2026-05-18T10:00:00Z',
  },
  players: [
    { id: 'p_me', handle: '@me', team: 't1', handCount: 2, status: 'connected', rank: null },
    { id: 'p_partner', handle: '@quan', team: 't1', handCount: 12, status: 'connected', rank: null },
    { id: 'p_left', handle: '@fan', team: 't2', handCount: 13, status: 'connected', rank: null },
    { id: 'p_right', handle: '@guo', team: 't2', handCount: 11, status: 'connected', rank: null },
  ],
};

describe('reduceEvent — snapshot', () => {
  it('hydrates myHand from yourHand', () => {
    const next = reduceEvent({ ...EMPTY }, snapshot, '@me');
    expect(next.myHand).toHaveLength(2);
    expect(next.myHand[0]).toEqual({ suit: 'hearts', rank: 'A', deck: 1 });
  });

  it('sets myTeam from you.teamId', () => {
    const next = reduceEvent({ ...EMPTY }, snapshot, '@me');
    expect(next.myTeam).toBe('t1');
  });

  it('records team levels', () => {
    const next = reduceEvent({ ...EMPTY }, snapshot, '@me');
    expect(next.teamLevels).toEqual({ t1: '5', t2: '6' });
  });

  it('populates players map keyed by id', () => {
    const next = reduceEvent({ ...EMPTY }, snapshot, '@me');
    expect(next.players.size).toBe(4);
    expect(next.players.get('p_left')?.handle).toBe('@fan');
  });
});

describe('reduceEvent — deal', () => {
  it('replaces myHand from yourHand', () => {
    const deal: DealEvent = {
      type: 'deal',
      version: 5,
      yourHand: ['7-D-1', '7-D-2', '8-C-1'],
      publicHandCounts: {},
      roundOwner: 't1',
    };
    const next = reduceEvent({ ...EMPTY }, deal, '@me');
    expect(next.myHand).toHaveLength(3);
    expect(next.lastPlayed).toBeNull();
  });
});

describe('reduceEvent — move_played', () => {
  it('records lastPlayed with author handle + cards', () => {
    const base = reduceEvent({ ...EMPTY }, snapshot, '@me');
    const move: MovePlayedEvent = {
      type: 'move_played',
      version: 6,
      player: 'p_left',
      cards: ['K-H-1', 'K-S-2'],
      combinationLabel: 'pair',
      nextTurn: 'p_partner',
      turnDeadline: '2026-05-18T10:00:30Z',
    };
    const next = reduceEvent(base, move, '@me');
    expect(next.lastPlayed?.player).toBe('@fan');
    expect(next.lastPlayed?.cards).toHaveLength(2);
    expect(next.lastPlayed?.combinationLabel).toBe('pair');
    expect(next.currentTurn).toBe('p_partner');
  });

  it('decrements handCount of opponent who played', () => {
    const base = reduceEvent({ ...EMPTY }, snapshot, '@me');
    const move: MovePlayedEvent = {
      type: 'move_played',
      version: 6,
      player: 'p_left',
      cards: ['K-H-1', 'K-S-2'],
      combinationLabel: 'pair',
      nextTurn: 'p_partner',
      turnDeadline: '2026-05-18T10:00:30Z',
    };
    const next = reduceEvent(base, move, '@me');
    expect(next.players.get('p_left')?.handCount).toBe(11);
  });
});

describe('reduceEvent — move_passed', () => {
  it('advances turn but keeps lastPlayed', () => {
    const base = reduceEvent({ ...EMPTY }, snapshot, '@me');
    const pass: MovePassedEvent = {
      type: 'move_passed',
      version: 7,
      player: 'p_partner',
      nextTurn: 'p_right',
      turnDeadline: '2026-05-18T10:01:00Z',
    };
    const next = reduceEvent(base, pass, '@me');
    expect(next.currentTurn).toBe('p_right');
  });
});

describe('reduceEvent — trick_won', () => {
  it('clears lastPlayed and sets next leader', () => {
    const base = reduceEvent({ ...EMPTY }, snapshot, '@me');
    const won: TrickWonEvent = {
      type: 'trick_won',
      version: 8,
      winner: 'p_left',
      nextLeader: 'p_left',
    };
    const next = reduceEvent({ ...base, lastPlayed: { player: '@fan', cards: [], combinationLabel: 'pair' } }, won, '@me');
    expect(next.lastPlayed).toBeNull();
    expect(next.currentTurn).toBe('p_left');
  });
});

describe('reduceEvent — room_joined / room_left', () => {
  it('adds joined player to players map', () => {
    const joined: RoomJoinedEvent = {
      type: 'room_joined',
      version: 2,
      player: { id: 'p_new', handle: '@newb', team: 't2', handCount: 0, status: 'connected', rank: null },
    };
    const next = reduceEvent({ ...EMPTY }, joined, '@me');
    expect(next.players.get('p_new')?.handle).toBe('@newb');
  });

  it('removes left player from players map', () => {
    const base = reduceEvent({ ...EMPTY }, snapshot, '@me');
    const left: RoomLeftEvent = {
      type: 'room_left',
      version: 3,
      playerId: 'p_left',
      reason: 'leave',
    };
    const next = reduceEvent(base, left, '@me');
    expect(next.players.has('p_left')).toBe(false);
  });
});

describe('splitSeats', () => {
  it('finds partner via partnerId and assigns rivals to left/right', () => {
    const base = reduceEvent({ ...EMPTY }, snapshot, '@me');
    const seats = splitSeats(base, '@me');
    expect(seats.partner?.id).toBe('p_partner');
    expect(seats.left?.team).toBe('t2');
    expect(seats.right?.team).toBe('t2');
  });

  it('returns nulls when no players present', () => {
    const seats = splitSeats({ ...EMPTY }, '@me');
    expect(seats).toEqual({ partner: null, left: null, right: null });
  });
});
