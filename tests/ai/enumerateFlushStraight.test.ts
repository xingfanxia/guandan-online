import { describe, expect, it } from 'vitest';
import { enumerateLegalPlays } from '@lib/ai/enumerate';
import type { Card } from '@lib/game/cards';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

describe('enumerateLegalPlays — flushStraight', () => {
  it('hand with 5 same-suit consecutive cards → flushStraight available', () => {
    const hand: Card[] = [
      c('spades', '3'), c('spades', '4'), c('spades', '5'),
      c('spades', '6'), c('spades', '7'),
    ];
    const plays = enumerateLegalPlays(hand, null, '8');
    expect(plays.some((p) => p.kind === 'flushStraight' && p.rank === '7')).toBe(true);
  });

  it('mixed-suit consecutive → straight only (no flushStraight)', () => {
    const hand: Card[] = [
      c('spades', '3'), c('hearts', '4'), c('clubs', '5'),
      c('diamonds', '6'), c('spades', '7'),
    ];
    const plays = enumerateLegalPlays(hand, null, '8');
    expect(plays.some((p) => p.kind === 'flushStraight')).toBe(false);
    expect(plays.some((p) => p.kind === 'straight')).toBe(true);
  });

  it('5 same-suit but non-consecutive → no flushStraight', () => {
    const hand: Card[] = [
      c('spades', '3'), c('spades', '5'), c('spades', '7'),
      c('spades', '9'), c('spades', 'J'),
    ];
    const plays = enumerateLegalPlays(hand, null, '2');
    expect(plays.some((p) => p.kind === 'flushStraight')).toBe(false);
  });

  it('with wildcard filling a same-suit gap → flushStraight emitted', () => {
    // Level 8: hearts-8 is wildcard. Hand: 3♠ 4♠ 6♠ 7♠ + wildcard → can fill 5♠
    const hand: Card[] = [
      c('spades', '3'), c('spades', '4'),
      c('hearts', '8'), // wildcard
      c('spades', '6'), c('spades', '7'),
    ];
    const plays = enumerateLegalPlays(hand, null, '8');
    expect(plays.some((p) => p.kind === 'flushStraight' && p.rank === '7')).toBe(true);
  });

  it('A-low flush straight (A-2-3-4-5 same suit)', () => {
    const hand: Card[] = [
      c('diamonds', 'A'), c('diamonds', '2'), c('diamonds', '3'),
      c('diamonds', '4'), c('diamonds', '5'),
    ];
    const plays = enumerateLegalPlays(hand, null, '8');
    expect(plays.some((p) => p.kind === 'flushStraight' && p.rank === '5')).toBe(true);
  });

  it('10-J-Q-K-A same suit → A-high flush straight', () => {
    const hand: Card[] = [
      c('clubs', '10'), c('clubs', 'J'), c('clubs', 'Q'),
      c('clubs', 'K'), c('clubs', 'A'),
    ];
    const plays = enumerateLegalPlays(hand, null, '8');
    expect(plays.some((p) => p.kind === 'flushStraight' && p.rank === 'A')).toBe(true);
  });
});
