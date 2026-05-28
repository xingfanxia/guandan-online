import { describe, it, expect } from 'vitest';
import { castExchangeVote, selectExchangeCards } from '@lib/game/exchangeFlow';
import type { Card } from '@lib/game/cards';
import type { GameRound, PlayerSeat, PendingExchangeState } from '@lib/game/round';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

const SEATS: PlayerSeat[] = [
  { id: 'p0', team: 't1', position: 0 },
  { id: 'p1', team: 't2', position: 1 },
  { id: 'p2', team: 't1', position: 2 },
  { id: 'p3', team: 't2', position: 3 },
];

function hand(prefix: string): Card[] {
  // 4 distinct cards per player, deterministic.
  return [c('spades', '3'), c('spades', '4'), c('spades', '5'), c('spades', '6')].map((x, i) => ({
    ...x,
    deck: ((prefix.charCodeAt(1) + i) % 2 === 0 ? 1 : 2) as Card['deck'],
    suit: (['spades', 'hearts', 'clubs', 'diamonds'] as const)[prefix.charCodeAt(1) % 4]!,
  }));
}

function roundWith(pending: PendingExchangeState): GameRound {
  return {
    mode: '4',
    level: '5',
    owner: 't1',
    seats: SEATS,
    hands: {
      p0: [c('spades', '3'), c('spades', '4'), c('spades', '5'), c('spades', '6')],
      p1: [c('hearts', '3'), c('hearts', '4'), c('hearts', '5'), c('hearts', '6')],
      p2: [c('clubs', '3'), c('clubs', '4'), c('clubs', '5'), c('clubs', '6')],
      p3: [c('diamonds', '3'), c('diamonds', '4'), c('diamonds', '5'), c('diamonds', '6')],
    },
    leader: 'p0',
    phase: 'playing',
    finishOrder: ['p0', 'p2', 'p1', 'p3'],
    currentTrick: null,
    pendingExchange: pending,
  };
}

function votePending(): PendingExchangeState {
  return {
    phase: 'vote',
    losers: ['p1', 'p3'],
    votes: {},
    voteThreshold: 0.5,
    cardCount: 1,
    direction: null,
    selections: {},
    leader: 'p0',
  };
}

describe('castExchangeVote', () => {
  it('records a vote and stays in-progress until all losers vote', () => {
    const r = castExchangeVote(roundWith(votePending()), 'p1', true, () => 0.1);
    expect(r.outcome).toBe('in-progress');
    expect(r.round.pendingExchange?.votes).toEqual({ p1: true });
    expect(r.round.currentTrick).toBeNull();
  });

  it('transitions to select phase with a direction when the vote passes', () => {
    let r = castExchangeVote(roundWith(votePending()), 'p1', true, () => 0.1);
    r = castExchangeVote(r.round, 'p3', true, () => 0.1);
    expect(r.outcome).toBe('voting-passed');
    expect(r.round.pendingExchange?.phase).toBe('select');
    expect(r.round.pendingExchange?.direction).toBe('cw'); // rng 0.1 → cw
    expect(r.round.currentTrick).toBeNull();
  });

  it('skips the exchange and starts the trick when the vote fails', () => {
    let r = castExchangeVote(roundWith(votePending()), 'p1', false, () => 0.1);
    r = castExchangeVote(r.round, 'p3', false, () => 0.1);
    expect(r.outcome).toBe('skipped');
    expect(r.round.pendingExchange).toBeUndefined();
    expect(r.round.currentTrick).not.toBeNull();
    expect(r.round.leader).toBe('p0');
  });

  it('throws when a non-loser tries to vote', () => {
    expect(() => castExchangeVote(roundWith(votePending()), 'p0', true, () => 0.1)).toThrow();
  });

  it('throws on a double vote', () => {
    const r = castExchangeVote(roundWith(votePending()), 'p1', true, () => 0.1);
    expect(() => castExchangeVote(r.round, 'p1', false, () => 0.1)).toThrow();
  });

  it('throws when not in the vote phase', () => {
    const selectPending: PendingExchangeState = { ...votePending(), phase: 'select', direction: 'cw' };
    expect(() => castExchangeVote(roundWith(selectPending), 'p1', true, () => 0.1)).toThrow();
  });
});

describe('selectExchangeCards', () => {
  function selectPending(): PendingExchangeState {
    return {
      phase: 'select',
      losers: ['p1', 'p3'],
      votes: { p1: true, p3: true },
      voteThreshold: 0.5,
      cardCount: 1,
      direction: 'cw',
      selections: {},
      leader: 'p0',
    };
  }

  it('records a selection and stays in-progress until all players select', () => {
    const r = selectExchangeCards(roundWith(selectPending()), 'p0', [c('spades', '3')]);
    expect(r.outcome).toBe('in-progress');
    expect(r.round.pendingExchange?.selections['p0']).toHaveLength(1);
    expect(r.round.currentTrick).toBeNull();
  });

  it('applies the swap and starts the trick when all players have selected', () => {
    let r = selectExchangeCards(roundWith(selectPending()), 'p0', [c('spades', '3')]);
    r = selectExchangeCards(r.round, 'p1', [c('hearts', '3')]);
    r = selectExchangeCards(r.round, 'p2', [c('clubs', '3')]);
    r = selectExchangeCards(r.round, 'p3', [c('diamonds', '3')]);
    expect(r.outcome).toBe('applied');
    expect(r.round.pendingExchange).toBeUndefined();
    expect(r.round.currentTrick).not.toBeNull();
    // cw: p0's spades-3 went to p1.
    expect(r.round.hands['p1']!.some((x) => x.suit === 'spades' && x.rank === '3')).toBe(true);
    // Hand sizes preserved.
    for (const id of ['p0', 'p1', 'p2', 'p3']) {
      expect(r.round.hands[id]).toHaveLength(4);
    }
  });

  it('throws on wrong card count', () => {
    expect(() =>
      selectExchangeCards(roundWith(selectPending()), 'p0', [c('spades', '3'), c('spades', '4')])
    ).toThrow();
  });

  it('throws when a selected card is not in hand', () => {
    expect(() =>
      selectExchangeCards(roundWith(selectPending()), 'p0', [c('hearts', 'A')])
    ).toThrow();
  });

  it('throws on a double selection', () => {
    const r = selectExchangeCards(roundWith(selectPending()), 'p0', [c('spades', '3')]);
    expect(() => selectExchangeCards(r.round, 'p0', [c('spades', '4')])).toThrow();
  });

  it('throws when not in the select phase', () => {
    expect(() => selectExchangeCards(roundWith(votePending()), 'p0', [c('spades', '3')])).toThrow();
  });
});

// silence unused helper
void hand;
