import { describe, it, expect } from 'vitest';
import { sortAndGroup } from '@/lib/assist/sort';
import type { Card } from '@lib/game/cards';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

describe('sortAndGroup', () => {
  it('sorts descending by power (RJ > BJ > level > A > … > 2)', () => {
    const hand: Card[] = [
      c('spades', '3'),
      c('joker', 'RJ'),
      c('clubs', 'A'),
      c('diamonds', '2', 2), // 2 = level → power 14
    ];
    const { sorted } = sortAndGroup(hand, '2');
    expect(sorted.map((x) => x.rank)).toEqual(['RJ', '2', 'A', '3']);
  });

  it('groups consecutive same-rank cards into clusters', () => {
    const hand: Card[] = [
      c('spades', 'K'),
      c('hearts', 'K', 2),
      c('clubs', '7'),
      c('diamonds', '7', 2),
      c('spades', '7'),
      c('clubs', '3'),
    ];
    const { clusters } = sortAndGroup(hand, '2');
    // Descending power: K,K | 7,7,7 | 3
    expect(clusters.map((g) => g.rank)).toEqual(['K', '7', '3']);
    expect(clusters.map((g) => g.cards.length)).toEqual([2, 3, 1]);
  });

  it('records startIndex aligned to the flat sorted array', () => {
    const hand: Card[] = [
      c('spades', 'K'),
      c('hearts', 'K', 2),
      c('clubs', '7'),
      c('clubs', '3'),
    ];
    const { sorted, clusters } = sortAndGroup(hand, '2');
    // Cluster startIndex must point at the cluster's first card in `sorted`.
    for (const g of clusters) {
      expect(sorted[g.startIndex]!.rank).toBe(g.rank);
    }
    expect(clusters.map((g) => g.startIndex)).toEqual([0, 2, 3]);
  });

  it('is deterministic — identical input yields identical clusters', () => {
    const hand: Card[] = [
      c('diamonds', '9', 2),
      c('spades', '9'),
      c('hearts', 'Q'),
      c('clubs', 'Q', 2),
    ];
    const a = sortAndGroup(hand, '5');
    const b = sortAndGroup(hand, '5');
    expect(a.clusters.map((g) => [g.rank, g.cards.length, g.startIndex])).toEqual(
      b.clusters.map((g) => [g.rank, g.cards.length, g.startIndex]),
    );
  });

  it('does not mutate the input array', () => {
    const hand: Card[] = [c('spades', '3'), c('clubs', 'A')];
    const before = hand.slice();
    sortAndGroup(hand, '2');
    expect(hand).toEqual(before);
  });

  it('handles empty hand', () => {
    const { sorted, clusters } = sortAndGroup([], '2');
    expect(sorted).toEqual([]);
    expect(clusters).toEqual([]);
  });

  it('clusters wildcards with the level rank (power 14)', () => {
    // At level 7, ♥7 is a wildcard (power 14, same as the level card slot).
    // It must cluster with other 7s by rank.
    const hand: Card[] = [
      c('hearts', '7'), // wildcard
      c('spades', '7'),
      c('clubs', 'A'),
    ];
    const { sorted, clusters } = sortAndGroup(hand, '7');
    // Both 7s sort above A (level power 14 > 13).
    expect(sorted.slice(0, 2).every((x) => x.rank === '7')).toBe(true);
    expect(clusters[0]!.rank).toBe('7');
    expect(clusters[0]!.cards.length).toBe(2);
  });
});
