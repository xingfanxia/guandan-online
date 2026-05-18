import { describe, expect, it } from 'vitest';
import { pickTributeCard, pickReturnCard } from '@lib/game/tribute';
import type { Card } from '@lib/game/cards';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

// ─── pickTributeCard ─────────────────────────────────────────────────────────

describe('pickTributeCard — highest non-wildcard card', () => {
  it('returns the highest natural card', () => {
    const hand: Card[] = [c('spades', '5'), c('hearts', 'A'), c('clubs', '7')];
    expect(pickTributeCard(hand, '2')).toEqual(c('hearts', 'A'));
  });

  it('jokers count as cards (RJ is the highest)', () => {
    const hand: Card[] = [c('spades', 'A'), c('joker', 'RJ'), c('joker', 'BJ')];
    expect(pickTributeCard(hand, '2')).toEqual(c('joker', 'RJ'));
  });

  it('level rank is highest natural (above A) — but tributable if NOT heart suit', () => {
    // Level 5 → spades-5 has powerRank 14 (above A). Not the wildcard. Tributable.
    const hand: Card[] = [c('spades', '5'), c('hearts', 'A'), c('clubs', '7')];
    expect(pickTributeCard(hand, '5')).toEqual(c('spades', '5'));
  });

  it('excludes the heart-level wildcard (红心级牌 is exempt)', () => {
    // Level 5 → hearts-5 IS the wildcard. Must skip it.
    const hand: Card[] = [c('hearts', '5'), c('hearts', 'A'), c('clubs', '7')];
    expect(pickTributeCard(hand, '5')).toEqual(c('hearts', 'A'));
  });

  it('hearts of NON-level rank is fine (not a wildcard)', () => {
    // Level 8 → no card here is a wildcard. Highest non-wildcard is hearts-A.
    const hand: Card[] = [c('hearts', 'A'), c('clubs', '7'), c('spades', '5')];
    expect(pickTributeCard(hand, '8')).toEqual(c('hearts', 'A'));
  });

  it('empty hand → null', () => {
    expect(pickTributeCard([], '2')).toBeNull();
  });

  it('hand of only wildcards → null', () => {
    // Edge case: only 2 wildcards in deck so this is highly unusual but defensible.
    expect(
      pickTributeCard([c('hearts', '5', 1), c('hearts', '5', 2)], '5')
    ).toBeNull();
  });
});

// ─── pickReturnCard — winner's return tribute ─────────────────────────────────

describe('pickReturnCard — smallest ≤10, or smallest overall if all > 10', () => {
  it('returns the lowest card when multiple ≤10 candidates exist', () => {
    const hand: Card[] = [c('spades', '10'), c('hearts', 'A'), c('clubs', '3')];
    expect(pickReturnCard(hand, '2')).toEqual(c('clubs', '3'));
  });

  it('respects the ≤10 cap — must pick from {2..10} when any exists', () => {
    const hand: Card[] = [c('spades', '10'), c('hearts', 'A'), c('clubs', 'K')];
    expect(pickReturnCard(hand, '2')).toEqual(c('spades', '10')); // only 10 qualifies
  });

  it('all > 10 → fall back to the smallest overall', () => {
    // Per rule: "If all cards in the winner's hand are above 10 ... they return
    //           their smallest card."
    const hand: Card[] = [c('hearts', 'A'), c('clubs', 'K'), c('spades', 'J')];
    expect(pickReturnCard(hand, '2')).toEqual(c('spades', 'J'));
  });

  it('excludes the heart-level wildcard from the return (same exemption as tribute)', () => {
    // Level 5: hearts-5 is wildcard, not eligible. Pick next-smallest ≤10.
    const hand: Card[] = [c('hearts', '5'), c('clubs', '7'), c('diamonds', 'A')];
    expect(pickReturnCard(hand, '5')).toEqual(c('clubs', '7'));
  });

  it('empty hand → null', () => {
    expect(pickReturnCard([], '2')).toBeNull();
  });

  it('hand of only wildcards → null', () => {
    expect(
      pickReturnCard([c('hearts', '5', 1), c('hearts', '5', 2)], '5')
    ).toBeNull();
  });
});
