// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  reduceEvent,
  splitSeats,
  buildTributeModalState,
  handHoldsRedJoker,
  shouldClearSelectedOnEvent,
} from '@/screens/GameTable4P';
import type {
  DealEvent,
  MovePlayedEvent,
  MovePassedEvent,
  PlayerSummary,
  RoomJoinedEvent,
  RoomLeftEvent,
  SnapshotEvent,
  TrickWonEvent,
  TributePendingEvent,
  TributeResolvedEvent,
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
  tribute: null,
  roundNumber: 1,
  lastRoundWinnerTeam: null,
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

describe('reduceEvent — tribute_pending / tribute_resolved', () => {
  it('stores the tribute snapshot on tribute_pending', () => {
    const base = reduceEvent({ ...EMPTY }, snapshot, '@me');
    const pend: TributePendingEvent = {
      type: 'tribute_pending',
      version: 2,
      direction: 'single',
      obligations: [{ from: 'p_left', to: 'p_partner', constraint: 'highest_non_heart' }],
    };
    const next = reduceEvent(base, pend, '@me');
    expect(next.tribute).toBeDefined();
    expect(next.tribute!.direction).toBe('single');
    expect(next.tribute!.obligations).toHaveLength(1);
  });

  it('preserves yourOwedCard when present', () => {
    const base = reduceEvent({ ...EMPTY }, snapshot, '@me');
    const pend: TributePendingEvent = {
      type: 'tribute_pending',
      version: 2,
      direction: 'single',
      obligations: [{ from: 'p_left', to: 'p_me', constraint: 'highest_non_heart' }],
      yourOwedCard: 'K-S-1',
    };
    const next = reduceEvent(base, pend, '@me');
    expect(next.tribute!.yourOwedCard).toBe('K-S-1');
  });

  it('clears the tribute snapshot on tribute_resolved', () => {
    let s = reduceEvent({ ...EMPTY }, snapshot, '@me');
    const pend: TributePendingEvent = {
      type: 'tribute_pending',
      version: 2,
      direction: 'double',
      obligations: [
        { from: 'p_left', to: 'p_me', constraint: 'highest_non_heart' },
        { from: 'p_right', to: 'p_partner', constraint: 'highest_non_heart' },
      ],
    };
    s = reduceEvent(s, pend, '@me');
    expect(s.tribute).not.toBeNull();
    const resolved: TributeResolvedEvent = {
      type: 'tribute_resolved',
      version: 3,
      exchanged: [
        { from: 'p_left', to: 'p_me', card: 'A-S-1' },
        { from: 'p_me', to: 'p_left', card: '5-D-1' },
      ],
    };
    const next = reduceEvent(s, resolved, '@me');
    expect(next.tribute).toBeNull();
  });

  it('clears the tribute snapshot on deal (new round opens fresh)', () => {
    let s = reduceEvent({ ...EMPTY }, snapshot, '@me');
    const pend: TributePendingEvent = {
      type: 'tribute_pending',
      version: 2,
      direction: 'single',
      obligations: [{ from: 'p_left', to: 'p_partner', constraint: 'highest_non_heart' }],
    };
    s = reduceEvent(s, pend, '@me');
    const deal: DealEvent = {
      type: 'deal',
      version: 3,
      yourHand: ['A-H-1'],
      publicHandCounts: { p_me: 1, p_partner: 0, p_left: 0, p_right: 0 },
      roundOwner: 't1',
    };
    const next = reduceEvent(s, deal, '@me');
    expect(next.tribute).toBeNull();
    expect(next.roundNumber).toBe(EMPTY.roundNumber + 1);
  });
});

describe('buildTributeModalState', () => {
  const players = new Map<string, PlayerSummary>([
    ['p_me', { id: 'p_me', handle: '@me', team: 't1', handCount: 27, status: 'connected', rank: null }],
    ['p_partner', { id: 'p_partner', handle: '@quan', team: 't1', handCount: 27, status: 'connected', rank: null }],
    ['p_left', { id: 'p_left', handle: '@fan', team: 't2', handCount: 27, status: 'connected', rank: null }],
    ['p_right', { id: 'p_right', handle: '@guo', team: 't2', handCount: 27, status: 'connected', rank: null }],
  ]);
  const myHand: GameCard[] = [
    { suit: 'spades', rank: 'A', deck: 1 },
    { suit: 'clubs', rank: '5', deck: 1 },
    { suit: 'hearts', rank: '2', deck: 1 }, // wildcard when level=2
  ];

  it('returns null when no snapshot', () => {
    const result = buildTributeModalState(null, myHand, 'p_me', 't1', players, '2', 1);
    expect(result).toBeNull();
  });

  it('renders pending mode when I am a `from` in single tribute', () => {
    const result = buildTributeModalState(
      {
        direction: 'single',
        obligations: [{ from: 'p_me', to: 'p_left', constraint: 'highest_non_heart' }],
      },
      myHand,
      'p_me',
      't1',
      players,
      '2',
      3,
    );
    expect(result?.kind).toBe('pending');
    if (result?.kind === 'pending') {
      expect(result.candidateKeys.size).toBe(2); // wildcard excluded
      expect(result.candidateKeys.has('A-spades-1')).toBe(true);
      expect(result.candidateKeys.has('5-clubs-1')).toBe(true);
      expect(result.candidateKeys.has('2-hearts-1')).toBe(false);
      expect(result.roundNumber).toBe(3);
    }
  });

  it('renders auto display when I am `to` and yourOwedCard is set', () => {
    const result = buildTributeModalState(
      {
        direction: 'single',
        obligations: [{ from: 'p_left', to: 'p_me', constraint: 'highest_non_heart' }],
        yourOwedCard: 'K-S-1',
      },
      myHand,
      'p_me',
      't1',
      players,
      '2',
      3,
    );
    expect(result?.kind).toBe('auto');
    if (result?.kind === 'auto') {
      expect(result.card).toEqual({ suit: 'spades', rank: 'K', deck: 1 });
      expect(result.fromHandle).toBe('@fan');
      expect(result.toHandle).toBe('@me');
    }
  });

  it('returns null when manual `to` (no yourOwedCard) — recipient waits silently', () => {
    const result = buildTributeModalState(
      {
        direction: 'single',
        obligations: [{ from: 'p_left', to: 'p_me', constraint: 'highest_non_heart' }],
      },
      myHand,
      'p_me',
      't1',
      players,
      '2',
      3,
    );
    expect(result).toBeNull();
  });

  it('renders anti-tribute banner on resist', () => {
    const result = buildTributeModalState(
      { direction: 'anti_tribute', obligations: [] },
      myHand,
      'p_me',
      't1',
      players,
      '2',
      3,
    );
    expect(result?.kind).toBe('anti-tribute');
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

  // F-M3: previously rivals[0]/rivals[1] came from Map insertion order,
  // which swapped clock positions depending on whose seat the local
  // player held. The fix uses seat-walk math (CW = left, CCW = right).
  it('seats opposing rivals at consistent clock positions across all 4 perspectives', () => {
    // Alternating-team snapshot (matches server's assignSeats output):
    // seat order: A (t1), B (t2), C (t1), D (t2)
    const altSnapshot: SnapshotEvent = {
      type: 'snapshot',
      version: 1,
      you: {
        playerId: 'pA',
        hand: [],
        teamId: 't1',
        partnerId: 'pC',
      },
      table: {
        currentTurn: 'pA',
        currentTrick: [],
        lastTrick: null,
        teamLevels: { t1: '2', t2: '2' },
        roundOwner: 't1',
        phase: 'playing',
        turnDeadline: '2026-05-18T10:00:00Z',
      },
      players: [
        { id: 'pA', handle: '@A', team: 't1', handCount: 27, status: 'connected', rank: null },
        { id: 'pB', handle: '@B', team: 't2', handCount: 27, status: 'connected', rank: null },
        { id: 'pC', handle: '@C', team: 't1', handCount: 27, status: 'connected', rank: null },
        { id: 'pD', handle: '@D', team: 't2', handCount: 27, status: 'connected', rank: null },
      ],
    };

    // From A's perspective: CW step 1 = B (left), step 2 = C (partner, skipped),
    // step 3 = D. So left=B, right=D, partner=C.
    const fromA = reduceEvent({ ...EMPTY }, altSnapshot, '@A');
    const seatsA = splitSeats(fromA, '@A');
    expect(seatsA.partner?.id).toBe('pC');
    expect(seatsA.left?.id).toBe('pB');
    expect(seatsA.right?.id).toBe('pD');

    // From C's perspective (partner of A): partnerId is pA. CW from C = D
    // (left), partner pA is skipped, then B = right.
    const cSnapshot: SnapshotEvent = {
      ...altSnapshot,
      you: { playerId: 'pC', hand: [], teamId: 't1', partnerId: 'pA' },
    };
    const fromC = reduceEvent({ ...EMPTY }, cSnapshot, '@C');
    const seatsC = splitSeats(fromC, '@C');
    expect(seatsC.partner?.id).toBe('pA');
    expect(seatsC.left?.id).toBe('pD');
    expect(seatsC.right?.id).toBe('pB');
  });
});

// ─── F-C2 — selected clearing on my own move_played ──────────────────────────

describe('shouldClearSelectedOnEvent (F-C2)', () => {
  const dealEvt: DealEvent = {
    type: 'deal',
    version: 1,
    yourHand: [],
    publicHandCounts: {},
    roundOwner: 't1',
  };

  it('clears on deal regardless of player', () => {
    expect(shouldClearSelectedOnEvent(dealEvt, 'p_me')).toBe(true);
    expect(shouldClearSelectedOnEvent(dealEvt, null)).toBe(true);
  });

  it('clears on snapshot regardless of player', () => {
    expect(shouldClearSelectedOnEvent(snapshot, 'p_me')).toBe(true);
  });

  it('clears on round_end regardless of player', () => {
    const roundEnd = {
      type: 'round_end',
      version: 9,
      winnerTeam: 't1',
      winnerRanks: [],
      upgrade: 1,
      newLevels: { t1: '3', t2: '2' },
    } as unknown as MovePlayedEvent;
    expect(shouldClearSelectedOnEvent(roundEnd, 'p_me')).toBe(true);
  });

  // The actual bug: previously, my move_played left stale selected indices
  // pointing into the now-shorter hand. This regression test pins that
  // move_played by me triggers a clear.
  it('clears on move_played BY ME', () => {
    const myMove: MovePlayedEvent = {
      type: 'move_played',
      version: 6,
      player: 'p_me',
      cards: ['K-H-1'],
      combinationLabel: 'single',
      nextTurn: 'p_left',
      turnDeadline: '',
    };
    expect(shouldClearSelectedOnEvent(myMove, 'p_me')).toBe(true);
  });

  it('does NOT clear on move_played BY ANOTHER PLAYER', () => {
    const oppMove: MovePlayedEvent = {
      type: 'move_played',
      version: 6,
      player: 'p_left',
      cards: ['K-H-1'],
      combinationLabel: 'single',
      nextTurn: 'p_partner',
      turnDeadline: '',
    };
    expect(shouldClearSelectedOnEvent(oppMove, 'p_me')).toBe(false);
  });

  it('does NOT clear on move_passed (even by me)', () => {
    const passed: MovePassedEvent = {
      type: 'move_passed',
      version: 7,
      player: 'p_me',
      nextTurn: 'p_left',
      turnDeadline: '',
    };
    expect(shouldClearSelectedOnEvent(passed, 'p_me')).toBe(false);
  });

  it('does NOT clear when myPlayerId is null and a move_played event arrives', () => {
    const myMove: MovePlayedEvent = {
      type: 'move_played',
      version: 6,
      player: 'p_me',
      cards: ['K-H-1'],
      combinationLabel: 'single',
      nextTurn: 'p_left',
      turnDeadline: '',
    };
    expect(shouldClearSelectedOnEvent(myMove, null)).toBe(false);
  });
});

// ─── F-I3 — anti-tribute modal gate ──────────────────────────────────────────

describe('buildTributeModalState — anti-tribute gating (F-I3)', () => {
  const players = new Map<string, PlayerSummary>([
    ['p_me', { id: 'p_me', handle: '@me', team: 't1', handCount: 27, status: 'connected', rank: null }],
    ['p_partner', { id: 'p_partner', handle: '@quan', team: 't1', handCount: 27, status: 'connected', rank: null }],
    ['p_left', { id: 'p_left', handle: '@fan', team: 't2', handCount: 27, status: 'connected', rank: null }],
    ['p_right', { id: 'p_right', handle: '@guo', team: 't2', handCount: 27, status: 'connected', rank: null }],
  ]);

  it('losing-team player (holds red joker) gets canDeclare=true', () => {
    const handWithRJ: GameCard[] = [
      { suit: 'spades', rank: 'A', deck: 1 },
      { suit: 'joker', rank: 'RJ', deck: 1 },
    ];
    const result = buildTributeModalState(
      { direction: 'anti_tribute', obligations: [] },
      handWithRJ,
      'p_me',
      't2',
      players,
      '2',
      3,
    );
    expect(result?.kind).toBe('anti-tribute');
    if (result?.kind === 'anti-tribute') {
      expect(result.canDeclare).toBe(true);
    }
  });

  it('winning-team player (no red joker) gets canDeclare=false', () => {
    const handNoRJ: GameCard[] = [
      { suit: 'spades', rank: 'A', deck: 1 },
      { suit: 'clubs', rank: 'K', deck: 1 },
    ];
    const result = buildTributeModalState(
      { direction: 'anti_tribute', obligations: [] },
      handNoRJ,
      'p_me',
      't1',
      players,
      '2',
      3,
    );
    expect(result?.kind).toBe('anti-tribute');
    if (result?.kind === 'anti-tribute') {
      expect(result.canDeclare).toBe(false);
    }
  });

  it('handHoldsRedJoker returns true only when hand contains a red joker', () => {
    expect(
      handHoldsRedJoker([{ suit: 'joker', rank: 'RJ', deck: 1 }]),
    ).toBe(true);
    expect(
      handHoldsRedJoker([
        { suit: 'spades', rank: 'A', deck: 1 },
        { suit: 'joker', rank: 'BJ', deck: 1 }, // black joker, not red
      ]),
    ).toBe(false);
    expect(handHoldsRedJoker([])).toBe(false);
  });

  // ─── Round 2 IMPORTANT-2 — canDeclare uses winnerTeam, not joker ownership ─

  it('Round 2 IMPORTANT-2: losing-team partner WITHOUT red joker gets canDeclare=true when lastRoundWinnerTeam is known', () => {
    // Pre-fix bug: only the joker-holder on the losing team got canDeclare.
    // The PARTNER (on the same losing team but holding zero red jokers) saw
    // the banner without the CTA. Post-fix: any losing-team player can declare.
    const handNoRJ: GameCard[] = [
      { suit: 'spades', rank: 'A', deck: 1 },
      { suit: 'clubs', rank: 'K', deck: 1 },
      // No red jokers.
    ];
    const result = buildTributeModalState(
      { direction: 'anti_tribute', obligations: [] },
      handNoRJ,
      'p_me',
      't2', // I am on t2 (losing team)
      players,
      '2',
      3,
      't1', // winning team is t1
    );
    expect(result?.kind).toBe('anti-tribute');
    if (result?.kind === 'anti-tribute') {
      // CRITICALLY: this was false pre-fix.
      expect(result.canDeclare).toBe(true);
    }
  });

  it('Round 2 IMPORTANT-2: winning-team player gets canDeclare=false even if they hold red jokers (anomalous deal)', () => {
    // Defensive case: in practice anti_tribute only fires when losers hold
    // both red jokers, but the gating must be on team, not jokers — so even
    // an anomalous deal where winner holds RJ should NOT enable declare.
    const handWithRJ: GameCard[] = [
      { suit: 'joker', rank: 'RJ', deck: 1 },
    ];
    const result = buildTributeModalState(
      { direction: 'anti_tribute', obligations: [] },
      handWithRJ,
      'p_me',
      't1', // I am on t1 (winning team)
      players,
      '2',
      3,
      't1', // winning team is t1
    );
    expect(result?.kind).toBe('anti-tribute');
    if (result?.kind === 'anti-tribute') {
      expect(result.canDeclare).toBe(false);
    }
  });

  it('Round 2 IMPORTANT-2: falls back to red-joker heuristic when lastRoundWinnerTeam is null', () => {
    // Defensive fallback for snapshot-only resume that missed the round_end.
    const handNoRJ: GameCard[] = [
      { suit: 'spades', rank: 'A', deck: 1 },
    ];
    const result = buildTributeModalState(
      { direction: 'anti_tribute', obligations: [] },
      handNoRJ,
      'p_me',
      't2',
      players,
      '2',
      3,
      null, // unknown winner — fallback to red-joker heuristic.
    );
    expect(result?.kind).toBe('anti-tribute');
    if (result?.kind === 'anti-tribute') {
      // No RJ → fallback heuristic returns false (preserves pre-fix behavior).
      expect(result.canDeclare).toBe(false);
    }
  });
});
