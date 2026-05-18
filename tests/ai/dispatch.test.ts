import { describe, it, expect } from 'vitest';
import { computeBotMove, type BotContext } from '@lib/ai/dispatch';
import type { Card } from '@lib/game/cards';

const c = (rank: Card['rank'], suit: Card['suit'], deck: Card['deck'] = 1): Card => ({ rank, suit, deck });

const baseCtx: Omit<BotContext, 'tier'> = {
  hand: [c('3', 'hearts'), c('3', 'spades'), c('K', 'clubs')],
  target: null,
  levelRank: '2',
  lastPlayer: null,
  me: 'me',
  partner: 'partner',
  partnerHandCount: 12,
  opponentHandCounts: [12, 13],
  rng: () => 0.99, // no noise
};

describe('computeBotMove', () => {
  it('dispatches easy tier to chooseEasyMove', () => {
    const move = computeBotMove({ ...baseCtx, tier: 'easy' });
    expect(move.kind).toBe('play');
  });

  it('dispatches medium tier to chooseMediumMove', () => {
    const move = computeBotMove({ ...baseCtx, tier: 'medium' });
    expect(move.kind).toBe('play');
  });

  it('throws for hard tier (async path required)', () => {
    expect(() => computeBotMove({ ...baseCtx, tier: 'hard' })).toThrow(/async/i);
  });
});
