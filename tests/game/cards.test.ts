import { describe, expect, it } from 'vitest';
import seedrandom from 'seedrandom';
import {
  buildDeck,
  shuffleDeck,
  deal,
  undealtCards,
  isWildcard,
  NATURAL_SUITS,
  NATURAL_RANKS,
  JOKER_RANKS,
} from '@lib/game/cards';
import type { Card } from '@lib/game/cards';

describe('buildDeck', () => {
  const deck = buildDeck();

  it('has exactly 108 cards', () => {
    expect(deck).toHaveLength(108);
  });

  it('has 8 cards per natural rank (4 suits × 2 decks)', () => {
    for (const rank of NATURAL_RANKS) {
      const count = deck.filter((c) => c.rank === rank).length;
      expect(count, `rank ${rank}`).toBe(8);
    }
  });

  it('has 26 cards per suit (13 ranks × 2 decks)', () => {
    for (const suit of NATURAL_SUITS) {
      const count = deck.filter((c) => c.suit === suit).length;
      expect(count, `suit ${suit}`).toBe(26);
    }
  });

  it('has 2 of each joker rank (one per deck)', () => {
    for (const jr of JOKER_RANKS) {
      const count = deck.filter((c) => c.rank === jr).length;
      expect(count, `joker ${jr}`).toBe(2);
    }
  });

  it('has 4 jokers total (2 BJ + 2 RJ)', () => {
    expect(deck.filter((c) => c.suit === 'joker')).toHaveLength(4);
  });

  it('balances deck 1 and deck 2 at 54 cards each', () => {
    expect(deck.filter((c) => c.deck === 1)).toHaveLength(54);
    expect(deck.filter((c) => c.deck === 2)).toHaveLength(54);
  });

  it('every card is unique by (suit, rank, deck)', () => {
    const keys = deck.map((c) => `${c.suit}-${c.rank}-${c.deck}`);
    expect(new Set(keys).size).toBe(108);
  });
});

describe('shuffleDeck', () => {
  it('returns a new array, does not mutate input', () => {
    const deck = buildDeck();
    const original = deck.slice();
    const shuffled = shuffleDeck(deck, seedrandom('seed-1'));
    expect(deck).toEqual(original); // unchanged
    expect(shuffled).not.toBe(deck); // new reference
  });

  it('preserves all 108 cards (permutation)', () => {
    const deck = buildDeck();
    const shuffled = shuffleDeck(deck, seedrandom('seed-2'));
    expect(shuffled).toHaveLength(108);
    expect([...shuffled].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))).toEqual(
      [...deck].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
    );
  });

  it('is deterministic for the same seed', () => {
    const a = shuffleDeck(buildDeck(), seedrandom('determinism-seed'));
    const b = shuffleDeck(buildDeck(), seedrandom('determinism-seed'));
    expect(a).toEqual(b);
  });

  it('produces different orderings for different seeds', () => {
    const a = shuffleDeck(buildDeck(), seedrandom('seed-A'));
    const b = shuffleDeck(buildDeck(), seedrandom('seed-B'));
    expect(a).not.toEqual(b);
  });

  it('does not return the input order for a known seed', () => {
    const deck = buildDeck();
    const shuffled = shuffleDeck(deck, seedrandom('non-identity'));
    // With 108 elements, P(identity shuffle) ≈ 1/108! — virtually zero.
    expect(shuffled).not.toEqual(deck);
  });
});

describe('deal', () => {
  const seededDeck = (seed: string) => shuffleDeck(buildDeck(), seedrandom(seed));

  it('4-player: 4 hands × 27 cards = all 108 dealt', () => {
    const hands = deal(seededDeck('4p-seed'), 4);
    expect(hands).toHaveLength(4);
    hands.forEach((h, i) => expect(h, `player ${i}`).toHaveLength(27));
    const total = hands.reduce((acc, h) => acc + h.length, 0);
    expect(total).toBe(108);
  });

  it('6-player: 6 hands × 18 cards = all 108 dealt', () => {
    const hands = deal(seededDeck('6p-seed'), 6);
    expect(hands).toHaveLength(6);
    hands.forEach((h, i) => expect(h, `player ${i}`).toHaveLength(18));
    const total = hands.reduce((acc, h) => acc + h.length, 0);
    expect(total).toBe(108);
  });

  it('8-player: 8 hands × 13 cards = 104 dealt, 4 left aside', () => {
    const deck = seededDeck('8p-seed');
    const hands = deal(deck, 8);
    expect(hands).toHaveLength(8);
    hands.forEach((h, i) => expect(h, `player ${i}`).toHaveLength(13));
    const dealtTotal = hands.reduce((acc, h) => acc + h.length, 0);
    expect(dealtTotal).toBe(104);
    expect(undealtCards(deck, 8)).toHaveLength(4);
  });

  it('hands contain disjoint cards (no duplicates across players)', () => {
    const hands = deal(seededDeck('disjoint-seed'), 4);
    const flat = hands.flat();
    const keys = flat.map(keyOf);
    expect(new Set(keys).size).toBe(flat.length);
  });

  it('throws on non-108-card deck (engine must use canonical deck)', () => {
    expect(() => deal(buildDeck().slice(0, 100), 4)).toThrow(/108/);
  });

  it('round-robin order (player i gets card i, i+N, i+2N, …)', () => {
    const deck = buildDeck(); // pre-shuffle for predictable check
    const hands = deal(deck, 4);
    expect(hands[0]![0]).toBe(deck[0]!);
    expect(hands[1]![0]).toBe(deck[1]!);
    expect(hands[2]![0]).toBe(deck[2]!);
    expect(hands[3]![0]).toBe(deck[3]!);
    expect(hands[0]![1]).toBe(deck[4]!);
  });
});

describe('undealtCards', () => {
  it('4P / 6P leave nothing aside', () => {
    const d = buildDeck();
    expect(undealtCards(d, 4)).toEqual([]);
    expect(undealtCards(d, 6)).toEqual([]);
  });

  it('8P leaves the last 4 cards aside', () => {
    const d = buildDeck();
    const aside = undealtCards(d, 8);
    expect(aside).toHaveLength(4);
    expect(aside[0]).toBe(d[104]!);
    expect(aside[3]).toBe(d[107]!);
  });
});

describe('isWildcard', () => {
  it('a heart matching the current level rank is a wildcard', () => {
    const card: Card = { suit: 'hearts', rank: '5', deck: 1 };
    expect(isWildcard(card, '5')).toBe(true);
  });

  it('a heart of a different rank is NOT a wildcard', () => {
    const card: Card = { suit: 'hearts', rank: '7', deck: 1 };
    expect(isWildcard(card, '5')).toBe(false);
  });

  it('a non-heart of the level rank is NOT a wildcard', () => {
    const card: Card = { suit: 'spades', rank: '5', deck: 1 };
    expect(isWildcard(card, '5')).toBe(false);
  });

  it('jokers are never wildcards (rule 4 — wildcard cannot substitute joker)', () => {
    expect(isWildcard({ suit: 'joker', rank: 'BJ', deck: 1 }, '5')).toBe(false);
    expect(isWildcard({ suit: 'joker', rank: 'RJ', deck: 2 }, '5')).toBe(false);
  });

  it('changes with the level — playing level-A makes hearts-A the wildcard', () => {
    const card: Card = { suit: 'hearts', rank: 'A', deck: 1 };
    expect(isWildcard(card, '5')).toBe(false);
    expect(isWildcard(card, 'A')).toBe(true);
  });
});

function keyOf(c: Card): string {
  return `${c.suit}-${c.rank}-${c.deck}`;
}
