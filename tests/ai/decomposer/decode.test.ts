import { describe, it, expect } from 'vitest';
import type { Card } from '@lib/game/cards';
import { decodeSolution } from '@lib/ai/decomposer/decode';

const c = (rank: Card['rank'], suit: Card['suit'], deck: Card['deck'] = 1): Card => ({ rank, suit, deck });

describe('decodeSolution', () => {
  it('parses a single-play solution and maps tokens to hand cards', () => {
    const hand: Card[] = [c('A', 'spades'), c('K', 'spades'), c('Q', 'spades')];
    const plays = decodeSolution('AS KS QS', hand);
    expect(plays).not.toBeNull();
    expect(plays!).toHaveLength(1);
    expect(plays![0]!.cards).toHaveLength(3);
    expect(plays![0]!.cards.map((card) => `${card.rank}${card.suit[0]}`)).toEqual(['As', 'Ks', 'Qs']);
  });

  it('parses pipe-separated multi-play solutions', () => {
    const hand: Card[] = [
      c('A', 'spades'),
      c('K', 'spades'),
      c('Q', 'spades'),
      c('2', 'hearts'),
      c('2', 'hearts', 2),
      c('RJ', 'joker'),
      c('BJ', 'joker'),
    ];
    const plays = decodeSolution('AS KS QS | 2H 2H | XR XB', hand);
    expect(plays).not.toBeNull();
    expect(plays!).toHaveLength(3);
    expect(plays![0]!.cards).toHaveLength(3);
    expect(plays![1]!.cards).toHaveLength(2);
    expect(plays![2]!.cards).toHaveLength(2);
  });

  it('disambiguates duplicate ranks across decks', () => {
    const hand: Card[] = [c('5', 'hearts', 1), c('5', 'hearts', 2)];
    const plays = decodeSolution('5H 5H', hand);
    expect(plays).not.toBeNull();
    expect(plays!).toHaveLength(1);
    const decks = plays![0]!.cards.map((card) => card.deck).sort();
    expect(decks).toEqual([1, 2]);
  });

  it('returns null when a token has no matching card in hand (wildcard substitution case)', () => {
    // Hand has no 6♣ — the solver presumably used a wildcard as 6♣ to
    // complete a straight. Decoder can't resolve the substitution; caller
    // is expected to fall back to heuristic.
    const hand: Card[] = [c('A', 'spades'), c('K', 'spades')];
    const plays = decodeSolution('AS KS 6C', hand);
    expect(plays).toBeNull();
  });

  it('handles 10 encoded as 0 in solution string', () => {
    const hand: Card[] = [c('10', 'hearts'), c('10', 'spades')];
    const plays = decodeSolution('0H 0S', hand);
    expect(plays).not.toBeNull();
    expect(plays![0]!.cards).toHaveLength(2);
  });

  it('handles whitespace variants and empty sections', () => {
    const hand: Card[] = [c('A', 'spades'), c('K', 'spades')];
    const plays = decodeSolution(' AS  KS ', hand);
    expect(plays).not.toBeNull();
    expect(plays![0]!.cards).toHaveLength(2);
  });

  it('returns null when token is malformed', () => {
    const hand: Card[] = [c('A', 'spades')];
    expect(decodeSolution('A', hand)).toBeNull(); // single-char (not joker)
    expect(decodeSolution('AAS', hand)).toBeNull(); // 3-char non-joker
  });
});
