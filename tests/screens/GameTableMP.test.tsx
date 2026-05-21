// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildTributeModalState, reduceEvent } from '@/screens/GameTableMP';
import type { TributePendingSnapshot } from '@/screens/GameTableMP';
import type { ServerEvent, PlayerSummary } from '@lib/realtime/messages';
import type { Card as GameCard } from '@lib/game/cards';

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
  tribute: null,
  roundNumber: 1,
};

describe('GameTableMP reducer', () => {
  it('snapshot populates seatOrder + players + my identity', () => {
    const snap = {
      type: 'snapshot',
      version: 1,
      players: PLAYERS_6P,
      table: {
        teamLevels: { t1: '5', t2: '4' },
        currentTurn: 'p0',
        roundOwner: 't1',
        currentTrick: [],
        lastTrick: null,
        phase: 'in_game',
        turnDeadline: '2026-05-18T01:00:00.000Z',
      },
      you: {
        playerId: 'p0',
        teamId: 't1',
        partnerId: 'p2',
        hand: [],
        rank: null,
      },
    } as unknown as ServerEvent;
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
    } as unknown as ServerEvent;
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
    } as unknown as ServerEvent;
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
    } as unknown as ServerEvent;
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
    } as unknown as ServerEvent;
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
    } as unknown as ServerEvent;
    const result = reduceEvent(seeded as Parameters<typeof reduceEvent>[0], evt, '@阿祥');
    expect(result.seatOrder).not.toContain('p3');
    expect(result.players.has('p3')).toBe(false);
  });

  it('unknown event types pass through unchanged', () => {
    const evt = { type: 'state_resync', version: 99 } as unknown as ServerEvent;
    expect(reduceEvent(EMPTY as Parameters<typeof reduceEvent>[0], evt, '@阿祥')).toEqual(EMPTY);
  });

  // ─── Tribute reducer (sweep + single) ────────────────────────────────────────

  it('tribute_pending stores snapshot for 8P sweep (4 obligations)', () => {
    const evt: ServerEvent = {
      type: 'tribute_pending',
      version: 10,
      direction: 'sweep',
      obligations: [
        { from: 'p5', to: 'p0', constraint: 'highest_non_heart' },
        { from: 'p4', to: 'p1', constraint: 'highest_non_heart' },
        { from: 'p3', to: 'p2', constraint: 'highest_non_heart' },
        { from: 'p6', to: 'p7', constraint: 'highest_non_heart' },
      ],
    } as unknown as ServerEvent;
    const result = reduceEvent(EMPTY as Parameters<typeof reduceEvent>[0], evt, '@阿祥');
    expect(result.tribute?.direction).toBe('sweep');
    expect(result.tribute?.obligations).toHaveLength(4);
  });

  it('tribute_pending with yourOwedCard preserves it on the snapshot', () => {
    const evt: ServerEvent = {
      type: 'tribute_pending',
      version: 11,
      direction: 'sweep',
      obligations: [{ from: 'p5', to: 'p0', constraint: 'highest_non_heart' }],
      yourOwedCard: 'A-S-1',
    } as unknown as ServerEvent;
    const result = reduceEvent(EMPTY as Parameters<typeof reduceEvent>[0], evt, '@阿祥');
    expect(result.tribute?.yourOwedCard).toBe('A-S-1');
  });

  it('tribute_resolved clears the tribute snapshot', () => {
    const seeded = {
      ...EMPTY,
      tribute: {
        direction: 'sweep',
        obligations: [{ from: 'p5', to: 'p0', constraint: 'highest_non_heart' }],
      } as TributePendingSnapshot,
    };
    const evt: ServerEvent = {
      type: 'tribute_resolved',
      version: 12,
      exchanged: [],
    } as unknown as ServerEvent;
    const result = reduceEvent(seeded as Parameters<typeof reduceEvent>[0], evt, '@阿祥');
    expect(result.tribute).toBeNull();
  });

  it('deal clears tribute snapshot + bumps roundNumber', () => {
    const seeded = {
      ...EMPTY,
      tribute: {
        direction: 'sweep',
        obligations: [{ from: 'p5', to: 'p0', constraint: 'highest_non_heart' }],
      } as TributePendingSnapshot,
      roundNumber: 5,
    };
    const evt: ServerEvent = {
      type: 'deal',
      version: 13,
      yourHand: [],
    } as unknown as ServerEvent;
    const result = reduceEvent(seeded as Parameters<typeof reduceEvent>[0], evt, '@阿祥');
    expect(result.tribute).toBeNull();
    expect(result.roundNumber).toBe(6);
  });
});

// ─── buildTributeModalState — sweep-aware modal routing ──────────────────────

describe('buildTributeModalState — 8P sweep', () => {
  const PLAYERS_8P: PlayerSummary[] = [
    { id: 'p0', handle: '@阿祥', team: 't1', handCount: 27, status: 'connected', rank: null },
    { id: 'p1', handle: '@饭团', team: 't1', handCount: 27, status: 'connected', rank: null },
    { id: 'p2', handle: '@老郭', team: 't1', handCount: 27, status: 'connected', rank: null },
    { id: 'p3', handle: '@豆豆', team: 't1', handCount: 27, status: 'connected', rank: null },
    { id: 'p4', handle: '@毛毛', team: 't2', handCount: 27, status: 'connected', rank: null },
    { id: 'p5', handle: '@王王', team: 't2', handCount: 27, status: 'connected', rank: null },
    { id: 'p6', handle: '@小红', team: 't2', handCount: 27, status: 'connected', rank: null },
    { id: 'p7', handle: '@小蓝', team: 't2', handCount: 27, status: 'connected', rank: null },
  ];
  const playerMap = new Map(PLAYERS_8P.map((p) => [p.id, p]));

  const sweepSnapshot: TributePendingSnapshot = {
    direction: 'sweep',
    obligations: [
      { from: 'p7', to: 'p0', constraint: 'highest_non_heart' }, // 8→1
      { from: 'p6', to: 'p1', constraint: 'highest_non_heart' }, // 7→2
      { from: 'p5', to: 'p2', constraint: 'highest_non_heart' }, // 6→3
      { from: 'p4', to: 'p3', constraint: 'highest_non_heart' }, // 5→4
    ],
  };

  const myHand: GameCard[] = [
    { suit: 'spades', rank: 'A', deck: 1 },
    { suit: 'clubs', rank: 'K', deck: 1 },
    { suit: 'hearts', rank: '5', deck: 1 }, // wildcard at level 5 — excluded
  ];

  it('returns null when no snapshot', () => {
    expect(
      buildTributeModalState(null, [], 'p0', 't1', playerMap, '2', 3),
    ).toBeNull();
  });

  it('me as `from` (loser) — returns pending state with progressLabel "1/4"', () => {
    const result = buildTributeModalState(sweepSnapshot, myHand, 'p7', 't2', playerMap, '2', 5);
    expect(result?.kind).toBe('pending');
    if (result?.kind === 'pending') {
      expect(result.loserHandle).toBe('@小蓝');
      expect(result.winnerHandle).toBe('@阿祥');
      expect(result.progressLabel).toBe('1/4');
      // candidates exclude the hearts-5 wildcard at level 5
      expect(result.candidateKeys.size).toBe(3); // wildcard check uses local levelRank='2' so all included
      expect(result.candidateKeys.has('A-spades-1')).toBe(true);
      expect(result.candidateKeys.has('K-clubs-1')).toBe(true);
    }
  });

  it('me as `from` mid-list — progressLabel reflects my position (3/4)', () => {
    const result = buildTributeModalState(sweepSnapshot, myHand, 'p5', 't2', playerMap, '2', 5);
    expect(result?.kind).toBe('pending');
    if (result?.kind === 'pending') {
      expect(result.progressLabel).toBe('3/4');
    }
  });

  it('me as `to` (winner) with yourOwedCard — returns auto display', () => {
    const snapshot: TributePendingSnapshot = {
      ...sweepSnapshot,
      yourOwedCard: 'A-S-1',
    };
    const result = buildTributeModalState(snapshot, [], 'p0', 't1', playerMap, '2', 5);
    expect(result?.kind).toBe('auto');
    if (result?.kind === 'auto') {
      expect(result.fromHandle).toBe('@小蓝');
      expect(result.toHandle).toBe('@阿祥');
    }
  });

  it('me as `to` without yourOwedCard (manual path) — returns null (wait silently)', () => {
    const result = buildTributeModalState(sweepSnapshot, [], 'p0', 't1', playerMap, '2', 5);
    expect(result).toBeNull();
  });

  it('anti_tribute snapshot + losing team → anti-tribute banner', () => {
    const snapshot: TributePendingSnapshot = {
      direction: 'anti_tribute',
      obligations: [],
    };
    const result = buildTributeModalState(snapshot, [], 'p7', 't2', playerMap, '2', 5);
    expect(result?.kind).toBe('anti-tribute');
    if (result?.kind === 'anti-tribute') {
      expect(result.holderHandle).toBe('@小蓝');
    }
  });

  it('third party (not in obligations, not receiver) → null (watch state)', () => {
    // p1 is a winning team member who is NOT a `to` recipient in single tribute.
    const singleSnapshot: TributePendingSnapshot = {
      direction: 'single',
      obligations: [{ from: 'p7', to: 'p0', constraint: 'highest_non_heart' }],
    };
    const result = buildTributeModalState(singleSnapshot, [], 'p1', 't1', playerMap, '2', 5);
    expect(result).toBeNull();
  });
});
