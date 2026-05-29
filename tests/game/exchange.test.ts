import { describe, it, expect } from 'vitest';
import {
  tallyExchangeVote,
  pickExchangeDirection,
  applyExchangeSwap,
  autoSelectLowest,
  openExchangeVote,
  DEFAULT_EXCHANGE_VOTE_THRESHOLD,
  DEFAULT_EXCHANGE_CARD_COUNT,
} from '@lib/game/exchange';
import type { Card } from '@lib/game/cards';
import type { GameRound, PlayerSeat } from '@lib/game/round';

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

function makeRound(seats: PlayerSeat[], leader: string): GameRound {
  const hands: Record<string, Card[]> = {};
  for (const s of seats) hands[s.id] = [];
  return {
    mode: seats.length === 4 ? '4' : seats.length === 6 ? '6' : '8',
    level: '2',
    owner: 't1',
    seats,
    hands,
    leader,
    phase: 'playing',
    finishOrder: [],
    currentTrick: null,
  };
}

describe('tallyExchangeVote', () => {
  it('is incomplete until all losers vote', () => {
    const r = tallyExchangeVote({ p1: true }, ['p1', 'p3'], 0.5);
    expect(r.complete).toBe(false);
  });

  it('passes when yes-fraction strictly exceeds the threshold', () => {
    // 2/2 yes > 0.5 → pass
    const r = tallyExchangeVote({ p1: true, p3: true }, ['p1', 'p3'], 0.5);
    expect(r).toEqual({ complete: true, passed: true });
  });

  it('fails when yes-fraction does not exceed the threshold', () => {
    // 1/2 = 0.5, NOT > 0.5 → fail
    const r = tallyExchangeVote({ p1: true, p3: false }, ['p1', 'p3'], 0.5);
    expect(r).toEqual({ complete: true, passed: false });
  });

  it('fails a unanimous-no vote', () => {
    const r = tallyExchangeVote({ p1: false, p3: false }, ['p1', 'p3'], 0.5);
    expect(r).toEqual({ complete: true, passed: false });
  });

  it('treats no losers as a vacuous complete-fail (nothing to exchange)', () => {
    const r = tallyExchangeVote({}, [], 0.5);
    expect(r.complete).toBe(true);
    expect(r.passed).toBe(false);
  });
});

describe('pickExchangeDirection', () => {
  it('returns cw for rng < 0.5, ccw otherwise', () => {
    expect(pickExchangeDirection(() => 0.1)).toBe('cw');
    expect(pickExchangeDirection(() => 0.9)).toBe('ccw');
  });
});

describe('autoSelectLowest', () => {
  it('picks the count lowest cards by power', () => {
    const hand = [c('spades', 'A'), c('hearts', '3'), c('clubs', 'K'), c('diamonds', '2')];
    const picked = autoSelectLowest(hand, 2, '5');
    // Lowest two at level 5: 2 and 3 (A and K are higher).
    const ranks = picked.map((p) => p.rank).sort();
    expect(ranks).toEqual(['2', '3']);
  });

  it('returns the whole hand when count exceeds hand size', () => {
    const hand = [c('spades', '7'), c('hearts', '8')];
    expect(autoSelectLowest(hand, 5, '5')).toHaveLength(2);
  });
});

describe('applyExchangeSwap', () => {
  it('cw: each player gives selected cards to the next seat and receives from the previous', () => {
    const hands: Record<string, Card[]> = {
      p0: [c('spades', '3'), c('spades', '4'), c('spades', '5'), c('spades', '6')],
      p1: [c('hearts', '3'), c('hearts', '4'), c('hearts', '5'), c('hearts', '6')],
      p2: [c('clubs', '3'), c('clubs', '4'), c('clubs', '5'), c('clubs', '6')],
      p3: [c('diamonds', '3'), c('diamonds', '4'), c('diamonds', '5'), c('diamonds', '6')],
    };
    const selections: Record<string, Card[]> = {
      p0: [c('spades', '3')],
      p1: [c('hearts', '3')],
      p2: [c('clubs', '3')],
      p3: [c('diamonds', '3')],
    };
    const out = applyExchangeSwap(hands, selections, 'cw', SEATS);
    // Hand count preserved for everyone.
    for (const id of ['p0', 'p1', 'p2', 'p3']) {
      expect(out[id]).toHaveLength(4);
    }
    // cw: p0 → p1. So p1 receives spades-3; p0 loses spades-3 and receives from p3 (diamonds-3).
    expect(out['p1']!.some((x) => x.suit === 'spades' && x.rank === '3')).toBe(true);
    expect(out['p0']!.some((x) => x.suit === 'spades' && x.rank === '3')).toBe(false);
    expect(out['p0']!.some((x) => x.suit === 'diamonds' && x.rank === '3')).toBe(true);
  });

  it('ccw: each player gives to the previous seat', () => {
    const hands: Record<string, Card[]> = {
      p0: [c('spades', '3'), c('spades', '4')],
      p1: [c('hearts', '3'), c('hearts', '4')],
      p2: [c('clubs', '3'), c('clubs', '4')],
      p3: [c('diamonds', '3'), c('diamonds', '4')],
    };
    const selections: Record<string, Card[]> = {
      p0: [c('spades', '3')],
      p1: [c('hearts', '3')],
      p2: [c('clubs', '3')],
      p3: [c('diamonds', '3')],
    };
    const out = applyExchangeSwap(hands, selections, 'ccw', SEATS);
    // ccw: p0 → p3. p3 receives spades-3.
    expect(out['p3']!.some((x) => x.suit === 'spades' && x.rank === '3')).toBe(true);
    expect(out['p0']!.some((x) => x.suit === 'spades' && x.rank === '3')).toBe(false);
    // p0 receives from p1 (hearts-3).
    expect(out['p0']!.some((x) => x.suit === 'hearts' && x.rank === '3')).toBe(true);
  });

  it('preserves total card conservation across the table', () => {
    const hands: Record<string, Card[]> = {
      p0: [c('spades', '3'), c('spades', '4'), c('spades', '5')],
      p1: [c('hearts', '3'), c('hearts', '4'), c('hearts', '5')],
      p2: [c('clubs', '3'), c('clubs', '4'), c('clubs', '5')],
      p3: [c('diamonds', '3'), c('diamonds', '4'), c('diamonds', '5')],
    };
    const selections: Record<string, Card[]> = {
      p0: [c('spades', '3'), c('spades', '4')],
      p1: [c('hearts', '3'), c('hearts', '4')],
      p2: [c('clubs', '3'), c('clubs', '4')],
      p3: [c('diamonds', '3'), c('diamonds', '4')],
    };
    const out = applyExchangeSwap(hands, selections, 'cw', SEATS);
    const total = Object.values(out).reduce((n, h) => n + h.length, 0);
    expect(total).toBe(12); // 4 players × 3 cards, conserved
  });
});

describe('openExchangeVote', () => {
  it('opens the vote with the losing team as voters and the round leader preserved', () => {
    // p0 (t1) won → losers are the t2 seats p1, p3.
    const round = makeRound(SEATS, 'p3');
    const opened = openExchangeVote(round, 'p0');
    expect(opened).not.toBeNull();
    const pe = opened!.pendingExchange!;
    expect(pe.phase).toBe('vote');
    expect(pe.losers.sort()).toEqual(['p1', 'p3']);
    expect(pe.voteThreshold).toBe(DEFAULT_EXCHANGE_VOTE_THRESHOLD);
    expect(pe.cardCount).toBe(DEFAULT_EXCHANGE_CARD_COUNT);
    expect(pe.direction).toBeNull();
    expect(pe.votes).toEqual({});
    expect(pe.selections).toEqual({});
    // Leader carries through so the trick starts on the right seat post-exchange.
    expect(pe.leader).toBe('p3');
    // currentTrick untouched — the vote/select flow starts it later.
    expect(opened!.currentTrick).toBeNull();
  });

  it('returns null when there are no losers (single-team table)', () => {
    const oneTeam: PlayerSeat[] = [
      { id: 'p0', team: 't1', position: 0 },
      { id: 'p1', team: 't1', position: 1 },
    ];
    const round = makeRound(oneTeam, 'p0');
    expect(openExchangeVote(round, 'p0')).toBeNull();
  });
});
