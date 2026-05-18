import { describe, it, expect } from 'vitest';
import { chooseMediumMove, type MediumContext } from '@lib/ai/medium';
import type { Card } from '@lib/game/cards';
import { analyzeHand } from '@lib/game/patterns';

const c = (rank: Card['rank'], suit: Card['suit'], deck: Card['deck'] = 1): Card => ({ rank, suit, deck });

const baseCtx: MediumContext = {
  target: null,
  lastPlayer: 'opp1',
  me: 'me',
  partner: 'partner',
  partnerHandCount: 12,
  opponentHandCounts: [12, 13],
  levelRank: '2',
  myHandCount: 4,
};

describe('chooseMediumMove — leader', () => {
  it('plays cheapest legal pattern when leading', () => {
    const hand: Card[] = [c('3', 'hearts'), c('3', 'spades'), c('K', 'clubs'), c('K', 'diamonds')];
    const move = chooseMediumMove(hand, { ...baseCtx, target: null });
    expect(move.kind).toBe('play');
    if (move.kind === 'play') {
      // Cheapest play among [pair 3, pair K, single 3, single K] = single 3
      expect(move.pattern.rank).toBe('3');
    }
  });

  it('prefers a finishing play when one exists (endgame)', () => {
    // Hand is exactly a pair → should play it to go out.
    const hand: Card[] = [c('10', 'hearts'), c('10', 'spades')];
    const move = chooseMediumMove(hand, { ...baseCtx, myHandCount: 2 });
    expect(move.kind).toBe('play');
    if (move.kind === 'play') {
      expect(move.pattern.cards).toHaveLength(2);
    }
  });

  it('throws when leading with empty hand (caller bug)', () => {
    expect(() => chooseMediumMove([], baseCtx)).toThrow();
  });
});

describe('chooseMediumMove — follower', () => {
  it('passes when no legal beat', () => {
    const hand: Card[] = [c('3', 'hearts'), c('3', 'spades')];
    const target = analyzeHand([c('K', 'hearts'), c('K', 'spades')], '2');
    if (!target || target.kind !== 'pair') throw new Error('expected pair target');
    const move = chooseMediumMove(hand, { ...baseCtx, target });
    expect(move.kind).toBe('pass');
  });

  it('plays cheapest beating play when one exists', () => {
    const hand: Card[] = [c('5', 'hearts'), c('5', 'spades'), c('A', 'hearts'), c('A', 'spades')];
    const target = analyzeHand([c('3', 'hearts'), c('3', 'spades')], '2');
    if (!target || target.kind !== 'pair') throw new Error('expected pair target');
    const move = chooseMediumMove(hand, { ...baseCtx, target });
    expect(move.kind).toBe('play');
    if (move.kind === 'play') {
      expect(move.pattern.rank).toBe('5'); // cheap pair 5 beats pair 3
    }
  });

  it('defers when partner just led — passes even with legal beat', () => {
    // Hand has extra cards so the pair-5 beat is NOT a going-out finisher.
    const hand: Card[] = [
      c('5', 'hearts'), c('5', 'spades'),
      c('9', 'clubs'), c('10', 'diamonds'),
    ];
    const target = analyzeHand([c('3', 'hearts'), c('3', 'spades')], '2');
    if (!target) throw new Error('expected target');
    const move = chooseMediumMove(hand, { ...baseCtx, target, lastPlayer: 'partner', myHandCount: 4 });
    expect(move.kind).toBe('pass');
  });

  it('defer + endgame finisher → still play (going out trumps deference)', () => {
    const hand: Card[] = [c('5', 'hearts'), c('5', 'spades')];
    const target = analyzeHand([c('3', 'hearts'), c('3', 'spades')], '2');
    if (!target) throw new Error('expected target');
    const move = chooseMediumMove(hand, {
      ...baseCtx,
      target,
      lastPlayer: 'partner',
      myHandCount: 2,
    });
    expect(move.kind).toBe('play');
  });
});
