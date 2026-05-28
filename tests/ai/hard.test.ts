import { describe, it, expect } from 'vitest';
import { chooseHardMove, type HardContext } from '@lib/ai/hard';
import { analyzeHand, type Pattern } from '@lib/game/patterns';
import type { Card } from '@lib/game/cards';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

function baseCtx(overrides: Partial<HardContext> = {}): HardContext {
  return {
    target: null,
    lastPlayer: null,
    me: 'p0',
    partner: 'p2',
    partnerHandCount: 13,
    opponentHandCounts: [13, 13],
    levelRank: '2',
    myHandCount: 13,
    ...overrides,
  };
}

const pair = (rank: Card['rank']): Pattern =>
  analyzeHand([c('spades', rank), c('hearts', rank)], '2')!;

describe('chooseHardMove — leader', () => {
  it('plays the endgame finisher when one play clears the hand', () => {
    const hand = [c('spades', '7'), c('hearts', '7')];
    const move = chooseHardMove(hand, baseCtx({ target: null }));
    expect(move.kind).toBe('play');
    if (move.kind === 'play') expect(move.pattern.cards).toHaveLength(2);
  });
});

describe('chooseHardMove — follower deny-the-finisher', () => {
  it('beats (does NOT pass) when an opponent is about to finish, even on a defer signal', () => {
    // Hand can beat a pair of 5s; partner just led (would normally defer),
    // but an opponent sits at 1 card → Hard denies them the lead.
    const hand = [c('spades', '9'), c('hearts', '9'), c('clubs', '3')];
    const move = chooseHardMove(
      hand,
      baseCtx({
        target: pair('5'),
        lastPlayer: 'p2', // partner led → defer signal
        opponentHandCounts: [1, 13], // opponent about to go out
      })
    );
    expect(move.kind).toBe('play'); // denied, not passed
  });

  it('passes (defers) when partner leads and no opponent is low', () => {
    const hand = [c('spades', '9'), c('hearts', '9'), c('clubs', '3')];
    const move = chooseHardMove(
      hand,
      baseCtx({
        target: pair('5'),
        lastPlayer: 'p2', // partner just played/won
        partnerHandCount: 3,
        opponentHandCounts: [13, 13],
      })
    );
    expect(move.kind).toBe('pass');
  });

  it('passes when it has no legal beat', () => {
    const hand = [c('spades', '3'), c('hearts', '3')];
    const move = chooseHardMove(
      hand,
      baseCtx({ target: pair('A'), lastPlayer: 'p1', opponentHandCounts: [13, 13] })
    );
    expect(move.kind).toBe('pass');
  });

  it('plays the endgame finisher as a follower even under a defer signal', () => {
    // The whole hand is a single pair that beats the target → going out wins.
    const hand = [c('spades', '9'), c('hearts', '9')];
    const move = chooseHardMove(
      hand,
      baseCtx({ target: pair('5'), lastPlayer: 'p2', opponentHandCounts: [13, 13] })
    );
    expect(move.kind).toBe('play');
    if (move.kind === 'play') expect(move.pattern.cards).toHaveLength(2);
  });
});
