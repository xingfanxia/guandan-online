import { describe, it, expect, vi } from 'vitest';
import {
  computeBotMove,
  computeBotMoveAsync,
  type BotContext,
} from '@lib/ai/dispatch';
import { createMemoryBudgetClient } from '@lib/ai/budget';
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

describe('computeBotMoveAsync', () => {
  it('routes easy + medium tiers through the sync path (no async work)', async () => {
    const easyMove = await computeBotMoveAsync({ ...baseCtx, tier: 'easy' });
    expect(easyMove.kind).toBe('play');
    const mediumMove = await computeBotMoveAsync({ ...baseCtx, tier: 'medium' });
    expect(mediumMove.kind).toBe('play');
  });

  it('hard tier falls back to medium when no generate fn is provided', async () => {
    // No throw — the medium-fallback path runs silently.
    const move = await computeBotMoveAsync({ ...baseCtx, tier: 'hard' });
    expect(move.kind).toBe('play');
  });

  it('hard tier invokes the injected generate fn (featureEnabled=true)', async () => {
    const generate = vi.fn(async () => ({ text: '选择: 1', costUsd: 0.0001 }));
    const move = await computeBotMoveAsync({
      ...baseCtx,
      tier: 'hard',
      generate,
      budget: createMemoryBudgetClient(),
      featureEnabled: true,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(move.kind).toBe('play');
  });

  it('hard tier respects featureEnabled=false (skips LLM, no fallback inside chooseHardMove)', async () => {
    const generate = vi.fn(async () => ({ text: '选择: 1' }));
    const move = await computeBotMoveAsync({
      ...baseCtx,
      tier: 'hard',
      generate,
      featureEnabled: false,
    });
    // featureEnabled=false → chooseHardMove returns its fallback without calling generate.
    expect(generate).not.toHaveBeenCalled();
    expect(move.kind).toBe('play');
  });

  it('hard tier silent-falls-back when generate throws', async () => {
    const generate = vi.fn(async () => {
      throw new Error('LLM down');
    });
    const move = await computeBotMoveAsync({
      ...baseCtx,
      tier: 'hard',
      generate,
      featureEnabled: true,
    });
    // Still returns a valid move (medium fallback inside chooseHardMove).
    expect(move.kind).toBe('play');
  });
});
