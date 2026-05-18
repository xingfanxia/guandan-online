import { describe, expect, it } from 'vitest';
import { enumerateLegalPlays } from '@lib/ai/enumerate';
import type { Card } from '@lib/game/cards';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

describe('enumerateLegalPlays — fullHouse', () => {
  it('hand with a natural triple + pair → fullHouse', () => {
    const hand: Card[] = [
      c('spades', '7'), c('hearts', '7'), c('clubs', '7'),
      c('spades', 'K'), c('hearts', 'K'),
    ];
    const plays = enumerateLegalPlays(hand, null, '2');
    expect(plays.some((p) => p.kind === 'fullHouse' && p.rank === '7')).toBe(true);
  });

  it('two natural pairs + 1 wildcard (level=5) → fullHouse with either triple rank', () => {
    // 7-7-K-K + wildcard. Wildcard can become 7 (triple of 7s + pair of Ks) OR
    // become K (pair of 7s + triple of Ks). Both fullHouses should be emitted.
    const hand: Card[] = [
      c('spades', '7'), c('clubs', '7'),
      c('spades', 'K'), c('clubs', 'K'),
      c('hearts', '5'), // wildcard
    ];
    const plays = enumerateLegalPlays(hand, null, '5');
    const fullHouseRanks = plays
      .filter((p) => p.kind === 'fullHouse')
      .map((p) => p.rank);
    expect(fullHouseRanks).toContain('7');
    expect(fullHouseRanks).toContain('K');
  });

  it('only 4 cards → no fullHouse (need exactly 5)', () => {
    const hand: Card[] = [
      c('spades', '7'), c('hearts', '7'), c('clubs', '7'),
      c('spades', 'K'),
    ];
    const plays = enumerateLegalPlays(hand, null, '2');
    expect(plays.some((p) => p.kind === 'fullHouse')).toBe(false);
  });

  it('5 same-rank → bomb takes precedence; no fullHouse emitted', () => {
    // 5 of one rank is a 5-card rank bomb, not a fullHouse interpretation.
    const hand: Card[] = [
      c('spades', '7'), c('hearts', '7'), c('clubs', '7'),
      c('diamonds', '7'), c('spades', '7', 2),
    ];
    const plays = enumerateLegalPlays(hand, null, '2');
    expect(plays.some((p) => p.kind === 'fullHouse')).toBe(false);
    expect(plays.some((p) => p.kind === 'bomb' && p.rank === '7' && p.length === 5)).toBe(true);
  });

  it('triple + single (no pair) → no fullHouse', () => {
    const hand: Card[] = [
      c('spades', '7'), c('hearts', '7'), c('clubs', '7'),
      c('spades', 'K'), c('hearts', 'A'),
    ];
    const plays = enumerateLegalPlays(hand, null, '2');
    expect(plays.some((p) => p.kind === 'fullHouse')).toBe(false);
  });

  it('following a fullHouse target: filtered by canBeat (triple rank comparison)', () => {
    const target = {
      kind: 'fullHouse' as const,
      rank: '7' as const,
      length: 5,
      cards: [],
    };
    const hand: Card[] = [
      c('spades', 'K'), c('hearts', 'K'), c('clubs', 'K'),
      c('spades', '3'), c('hearts', '3'),
      c('spades', '5'), c('hearts', '5'), c('clubs', '5'),
      c('diamonds', '4'), c('clubs', '4'),
    ];
    const plays = enumerateLegalPlays(hand, target, '2');
    const fhRanks = plays
      .filter((p) => p.kind === 'fullHouse')
      .map((p) => p.rank);
    expect(fhRanks).toContain('K'); // K > 7
    expect(fhRanks).not.toContain('5'); // 5 < 7
  });
});
