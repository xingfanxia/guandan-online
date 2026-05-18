import { describe, expect, it } from 'vitest';
import {
  countWildcards,
  partitionWildcards,
  WILDCARD_NEVER_RANKS,
} from '@lib/game/wildcard';
import type { Card } from '@lib/game/cards';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

describe('countWildcards', () => {
  it('counts zero when no card matches heart-level pattern', () => {
    const hand: Card[] = [
      c('spades', '5'),
      c('clubs', '5'),
      c('hearts', '7'),
      c('diamonds', '5'),
    ];
    expect(countWildcards(hand, '5')).toBe(0);
  });

  it('counts the single heart-level card present', () => {
    const hand: Card[] = [c('hearts', '5'), c('spades', '5'), c('diamonds', '7')];
    expect(countWildcards(hand, '5')).toBe(1);
  });

  it('counts both heart-level cards (one per deck)', () => {
    const hand: Card[] = [
      c('hearts', '5', 1),
      c('hearts', '5', 2),
      c('spades', 'A'),
    ];
    expect(countWildcards(hand, '5')).toBe(2);
  });

  it('updates with level changes — same hand, different levels', () => {
    const hand: Card[] = [c('hearts', '5'), c('hearts', 'A'), c('hearts', 'K')];
    expect(countWildcards(hand, '5')).toBe(1);
    expect(countWildcards(hand, 'A')).toBe(1);
    expect(countWildcards(hand, 'K')).toBe(1);
    expect(countWildcards(hand, '2')).toBe(0);
  });

  it('does not count jokers (rule 4 — wildcard cannot substitute joker)', () => {
    const hand: Card[] = [
      c('joker', 'BJ'),
      c('joker', 'RJ'),
      c('hearts', '5'),
    ];
    expect(countWildcards(hand, '5')).toBe(1); // only the heart-5
  });

  it('returns 0 for empty hand', () => {
    expect(countWildcards([], '5')).toBe(0);
  });
});

describe('partitionWildcards', () => {
  it('splits a hand into wildcards and naturals', () => {
    const wc1 = c('hearts', '5', 1);
    const wc2 = c('hearts', '5', 2);
    const nat1 = c('spades', 'A');
    const nat2 = c('diamonds', '7');
    const { wildcards, naturals } = partitionWildcards([wc1, nat1, wc2, nat2], '5');
    expect(wildcards).toEqual([wc1, wc2]);
    expect(naturals).toEqual([nat1, nat2]);
  });

  it('preserves order within each partition', () => {
    const wc1 = c('hearts', '5', 1);
    const wc2 = c('hearts', '5', 2);
    const nat1 = c('spades', '3');
    const nat2 = c('spades', '4');
    const nat3 = c('spades', '6');
    const { wildcards, naturals } = partitionWildcards(
      [nat1, wc1, nat2, wc2, nat3],
      '5'
    );
    expect(wildcards).toEqual([wc1, wc2]);
    expect(naturals).toEqual([nat1, nat2, nat3]);
  });

  it('returns empty wildcards when no heart-level card present', () => {
    const hand: Card[] = [c('spades', '5'), c('diamonds', 'A')];
    const { wildcards, naturals } = partitionWildcards(hand, '5');
    expect(wildcards).toEqual([]);
    expect(naturals).toEqual(hand);
  });

  it('returns empty naturals when entire hand is wildcards (degenerate but valid)', () => {
    const hand: Card[] = [c('hearts', '5', 1), c('hearts', '5', 2)];
    const { wildcards, naturals } = partitionWildcards(hand, '5');
    expect(wildcards).toEqual(hand);
    expect(naturals).toEqual([]);
  });

  it('returns empty for empty input', () => {
    const { wildcards, naturals } = partitionWildcards([], '5');
    expect(wildcards).toEqual([]);
    expect(naturals).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const hand: Card[] = [c('hearts', '5'), c('spades', '5')];
    const snapshot = [...hand];
    partitionWildcards(hand, '5');
    expect(hand).toEqual(snapshot);
  });
});

describe('WILDCARD_NEVER_RANKS', () => {
  it('exposes the joker ranks that a wildcard can never substitute (rule 4)', () => {
    expect(WILDCARD_NEVER_RANKS).toEqual(['BJ', 'RJ']);
  });

  it('is a readonly tuple — type-level guarantee, runtime check via Array.isArray', () => {
    expect(Array.isArray(WILDCARD_NEVER_RANKS)).toBe(true);
    expect(WILDCARD_NEVER_RANKS).toHaveLength(2);
  });
});
