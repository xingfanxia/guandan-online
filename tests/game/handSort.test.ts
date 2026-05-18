import { describe, expect, it } from 'vitest';
import { sortHand } from '@lib/game/handSort';
import type { Card } from '@lib/game/cards';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

describe('sortHand — empty + singletons', () => {
  it('empty hand → empty', () => {
    expect(sortHand([], '2')).toEqual([]);
  });

  it('single card → single card', () => {
    expect(sortHand([c('spades', '7')], '2')).toEqual([c('spades', '7')]);
  });

  it('does not mutate the input', () => {
    const input: Card[] = [c('spades', '7'), c('hearts', '5')];
    const snapshot = [...input];
    sortHand(input, '2');
    expect(input).toEqual(snapshot);
  });
});

describe('sortHand — descending by power rank (highest first)', () => {
  it('A > K > Q > J > 10 > … > 2 when no level effect', () => {
    const hand: Card[] = [
      c('spades', '5'), c('spades', 'A'), c('spades', 'K'),
      c('spades', '2'), c('spades', '10'),
    ];
    const out = sortHand(hand, '7');
    expect(out.map((x) => x.rank)).toEqual(['A', 'K', '10', '5', '2']);
  });

  it('level rank lifts to top of natural cards (above A)', () => {
    const hand: Card[] = [
      c('spades', '5'), c('spades', 'A'), c('spades', 'K'), c('spades', '7'),
    ];
    // Level 7 → 7 lifts to 14, above A
    const out = sortHand(hand, '7');
    expect(out.map((x) => x.rank)).toEqual(['7', 'A', 'K', '5']);
  });

  it('RJ > BJ > level > A', () => {
    const hand: Card[] = [
      c('joker', 'RJ'), c('joker', 'BJ'),
      c('spades', '5'), c('spades', 'A'),
    ];
    const out = sortHand(hand, '5');
    expect(out.map((x) => x.rank)).toEqual(['RJ', 'BJ', '5', 'A']);
  });
});

describe('sortHand — stable secondary sort (suit, then deck)', () => {
  it('cards of the same rank ordered by suit: spades > hearts > clubs > diamonds', () => {
    const hand: Card[] = [
      c('diamonds', '7'), c('spades', '7'), c('clubs', '7'), c('hearts', '7'),
    ];
    const out = sortHand(hand, '2');
    expect(out.map((x) => x.suit)).toEqual(['spades', 'hearts', 'clubs', 'diamonds']);
  });

  it('cards of the same suit + rank ordered by deck (1 before 2)', () => {
    const hand: Card[] = [
      c('spades', '7', 2), c('spades', '7', 1),
    ];
    const out = sortHand(hand, '2');
    expect(out.map((x) => x.deck)).toEqual([1, 2]);
  });
});

describe('sortHand — full hand sanity check', () => {
  it('combines power, suit, and deck ordering consistently', () => {
    const hand: Card[] = [
      c('clubs', '5'),
      c('joker', 'BJ', 1),
      c('hearts', 'A'),
      c('spades', 'A'),
      c('clubs', '7', 2),
      c('spades', '7', 1),
    ];
    const out = sortHand(hand, '7');
    // Expected: 7♠₁ > 7♣₂ (both level rank 14) > BJ (15) > … hmm let me re-check.
    // Level 7 = 14. BJ = 15. So BJ is HIGHER than level rank.
    // Order: BJ(15) > 7♠₁(14) > 7♣₂(14) > A♠(13) > A♥(13) > 5♣(4)
    expect(out.map((x) => `${x.rank}-${x.suit}-${x.deck}`)).toEqual([
      'BJ-joker-1',
      '7-spades-1',
      '7-clubs-2',
      'A-spades-1',
      'A-hearts-1',
      '5-clubs-1',
    ]);
  });
});
