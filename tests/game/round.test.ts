import { describe, expect, it } from 'vitest';
import seedrandom from 'seedrandom';
import {
  dealRound,
  selectFirstLeader,
} from '@lib/game/round';
import type { PlayerSeat } from '@lib/game/round';
import { buildDeck, shuffleDeck } from '@lib/game/cards';
import type { Card } from '@lib/game/cards';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SEATS_4P: PlayerSeat[] = [
  { id: 'alice', team: 't1', position: 0 },
  { id: 'bob', team: 't2', position: 1 },
  { id: 'carol', team: 't1', position: 2 },
  { id: 'dave', team: 't2', position: 3 },
];

const SEATS_6P: PlayerSeat[] = [
  { id: 'p1', team: 't1', position: 0 },
  { id: 'p2', team: 't2', position: 1 },
  { id: 'p3', team: 't1', position: 2 },
  { id: 'p4', team: 't2', position: 3 },
  { id: 'p5', team: 't1', position: 4 },
  { id: 'p6', team: 't2', position: 5 },
];

const SEATS_8P: PlayerSeat[] = Array.from({ length: 8 }, (_, i) => ({
  id: `seat${i}`,
  team: (i % 2 === 0 ? 't1' : 't2') as 't1' | 't2',
  position: i,
}));

const shuffled = (seed: string): Card[] =>
  shuffleDeck(buildDeck(), seedrandom(seed));

// ─── dealRound: 4P / 6P / 8P sizes ────────────────────────────────────────────

describe('dealRound — hand sizes by mode', () => {
  it('4P: 4 hands × 27 cards', () => {
    const round = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: shuffled('4p-1'),
    });
    expect(Object.keys(round.hands)).toHaveLength(4);
    for (const id of ['alice', 'bob', 'carol', 'dave']) {
      expect(round.hands[id], `player ${id}`).toHaveLength(27);
    }
  });

  it('6P: 6 hands × 18 cards', () => {
    const round = dealRound({
      mode: '6',
      level: '2',
      owner: null,
      seats: SEATS_6P,
      leader: 'p1',
      shuffledDeck: shuffled('6p-1'),
    });
    for (const seat of SEATS_6P) {
      expect(round.hands[seat.id]).toHaveLength(18);
    }
  });

  it('8P: 8 hands × 13 cards (4 cards left aside)', () => {
    const round = dealRound({
      mode: '8',
      level: '2',
      owner: null,
      seats: SEATS_8P,
      leader: 'seat0',
      shuffledDeck: shuffled('8p-1'),
    });
    for (const seat of SEATS_8P) {
      expect(round.hands[seat.id]).toHaveLength(13);
    }
    // 8 × 13 = 104; the 4 undealt cards are not in any player's hand
    const totalDealt = Object.values(round.hands)
      .reduce((sum, h) => sum + h.length, 0);
    expect(totalDealt).toBe(104);
  });
});

// ─── dealRound: initial state ────────────────────────────────────────────────

describe('dealRound — initial state', () => {
  it('phase is "playing" immediately after deal', () => {
    const round = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: shuffled('phase-test'),
    });
    expect(round.phase).toBe('playing');
  });

  it('finishOrder is empty', () => {
    const round = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: shuffled('finish-test'),
    });
    expect(round.finishOrder).toEqual([]);
  });

  it('preserves mode / level / owner / seats / leader from input', () => {
    const round = dealRound({
      mode: '4',
      level: 'A',
      owner: 't1',
      seats: SEATS_4P,
      leader: 'carol',
      shuffledDeck: shuffled('preserve-test'),
    });
    expect(round.mode).toBe('4');
    expect(round.level).toBe('A');
    expect(round.owner).toBe('t1');
    expect(round.seats).toEqual(SEATS_4P);
    expect(round.leader).toBe('carol');
  });

  it('hands are disjoint (no card appears in two players\' hands)', () => {
    const round = dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'alice',
      shuffledDeck: shuffled('disjoint'),
    });
    const allCards = Object.values(round.hands).flat();
    const keys = allCards.map((c) => `${c.suit}-${c.rank}-${c.deck}`);
    expect(new Set(keys).size).toBe(allCards.length);
  });

  it('is deterministic for the same shuffled deck input', () => {
    const deck = shuffled('determinism');
    const r1 = dealRound({
      mode: '4', level: '2', owner: null,
      seats: SEATS_4P, leader: 'alice', shuffledDeck: deck,
    });
    const r2 = dealRound({
      mode: '4', level: '2', owner: null,
      seats: SEATS_4P, leader: 'alice', shuffledDeck: deck,
    });
    expect(r2.hands).toEqual(r1.hands);
  });
});

// ─── dealRound: validation ────────────────────────────────────────────────────

describe('dealRound — input validation', () => {
  it('throws if seats count does not match mode', () => {
    expect(() =>
      dealRound({
        mode: '4',
        level: '2',
        owner: null,
        seats: SEATS_6P, // wrong size
        leader: 'p1',
        shuffledDeck: shuffled('mismatch'),
      })
    ).toThrow(/seats|mode|4/);
  });

  it('throws if leader is not in seats', () => {
    expect(() =>
      dealRound({
        mode: '4',
        level: '2',
        owner: null,
        seats: SEATS_4P,
        leader: 'someone-else',
        shuffledDeck: shuffled('bad-leader'),
      })
    ).toThrow(/leader/);
  });

  it('throws if deck is not 108 cards', () => {
    expect(() =>
      dealRound({
        mode: '4',
        level: '2',
        owner: null,
        seats: SEATS_4P,
        leader: 'alice',
        shuffledDeck: shuffled('short').slice(0, 100),
      })
    ).toThrow(/108/);
  });
});

// ─── selectFirstLeader: find player holding a target card ─────────────────────

describe('selectFirstLeader', () => {
  const buildHands = (): Record<string, Card[]> => ({
    alice: [
      { suit: 'spades', rank: '2', deck: 1 },
      { suit: 'hearts', rank: 'A', deck: 1 },
    ],
    bob: [
      { suit: 'diamonds', rank: '5', deck: 2 },
      { suit: 'clubs', rank: '7', deck: 1 },
    ],
    carol: [
      { suit: 'spades', rank: 'K', deck: 2 },
    ],
  });

  it('finds the player holding the target card (exact match incl. deck)', () => {
    expect(
      selectFirstLeader(buildHands(), { suit: 'diamonds', rank: '5', deck: 2 })
    ).toBe('bob');
  });

  it('matches by suit + rank when deck is omitted', () => {
    expect(
      selectFirstLeader(buildHands(), { suit: 'hearts', rank: 'A' })
    ).toBe('alice');
  });

  it('returns null when no player holds the target card', () => {
    expect(
      selectFirstLeader(buildHands(), { suit: 'hearts', rank: 'Q' })
    ).toBeNull();
  });

  it('returns the first player holding the card when multiple match (suit+rank only)', () => {
    const hands: Record<string, Card[]> = {
      alice: [{ suit: 'spades', rank: '5', deck: 1 }],
      bob: [{ suit: 'spades', rank: '5', deck: 2 }],
    };
    // suit+rank match — alice listed first → wins
    expect(selectFirstLeader(hands, { suit: 'spades', rank: '5' })).toBe('alice');
  });

  it('handles empty hands gracefully', () => {
    expect(
      selectFirstLeader({}, { suit: 'spades', rank: '2' })
    ).toBeNull();
  });
});
