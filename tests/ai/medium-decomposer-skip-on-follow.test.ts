// G-I3: chooseMediumMove must NOT call the decomposer on follower turns.
//
// The decomposer's first-play suggestion is target-blind — it analyzes the
// standalone hand without knowing the current trick. On follower turns the
// suggestion almost never matches the trick target, so the WASM call is
// pure waste. Verify by mocking the decomposer module and asserting the
// call counts.
//
// Isolated in its own file so the vi.mock factory doesn't bleed into other
// medium tests that need the real decomposer.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Card } from '@lib/game/cards';
import { analyzeHand } from '@lib/game/patterns';

// vi.mock is hoisted; declare the mock fn via vi.hoisted so it's available
// at hoist time. The mocked module replaces the decomposer's public surface
// with stubs we can introspect.
const mocks = vi.hoisted(() => ({
  decomposeHand: vi.fn(),
  preloadDecomposer: vi.fn(async () => undefined),
}));

vi.mock('@lib/ai/decomposer', () => ({
  decomposeHand: mocks.decomposeHand,
  preloadDecomposer: mocks.preloadDecomposer,
}));

import { chooseMediumMove, type MediumContext } from '@lib/ai/medium';

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

beforeEach(() => {
  mocks.decomposeHand.mockReset();
  // Return null by default — caller treats as fallback signal.
  mocks.decomposeHand.mockReturnValue(null);
});

describe('chooseMediumMove — G-I3: decomposer skipped on follower turns', () => {
  it('LEADING: decomposer IS called', () => {
    // No target → leader path → decomposer is queried.
    const hand: Card[] = [
      c('5', 'hearts'), c('5', 'spades'),
      c('K', 'clubs'), c('K', 'diamonds'),
    ];
    chooseMediumMove(hand, { ...baseCtx, target: null, myHandCount: 4 });
    expect(mocks.decomposeHand).toHaveBeenCalledTimes(1);
  });

  it('FOLLOWING: decomposer is NOT called (skipped to save CPU)', () => {
    // Follower with a beatable target. Pre-fix: tryDecomposerMatch ran
    // here and wasted CPU. Post-fix: heuristic runs directly.
    const hand: Card[] = [
      c('5', 'hearts'), c('5', 'spades'),
      c('A', 'clubs'), c('A', 'diamonds'),
    ];
    const target = analyzeHand([c('3', 'hearts'), c('3', 'spades')], '2');
    if (!target || target.kind !== 'pair') throw new Error('expected pair target');
    const move = chooseMediumMove(hand, { ...baseCtx, target, myHandCount: 4 });
    expect(mocks.decomposeHand).not.toHaveBeenCalled();
    // Heuristic still picks a play (cheapest beating play).
    expect(move.kind).toBe('play');
  });

  it('FOLLOWING with no legal beat: decomposer still NOT called (pass)', () => {
    // Follower with no legal play → pass; decomposer untouched.
    const hand: Card[] = [c('3', 'hearts'), c('3', 'spades')];
    const target = analyzeHand([c('K', 'hearts'), c('K', 'spades')], '2');
    if (!target || target.kind !== 'pair') throw new Error('expected pair target');
    chooseMediumMove(hand, { ...baseCtx, target });
    expect(mocks.decomposeHand).not.toHaveBeenCalled();
  });

  it('FOLLOWING with defer policy (partner just won): decomposer NOT called', () => {
    // Defer path returns early without consulting the decomposer.
    const hand: Card[] = [
      c('5', 'hearts'), c('5', 'spades'),
      c('9', 'clubs'), c('10', 'diamonds'),
    ];
    const target = analyzeHand([c('3', 'hearts'), c('3', 'spades')], '2');
    if (!target) throw new Error('expected target');
    chooseMediumMove(hand, {
      ...baseCtx,
      target,
      lastPlayer: 'partner',
      myHandCount: 4,
    });
    expect(mocks.decomposeHand).not.toHaveBeenCalled();
  });

  it('FOLLOWING with endgame finisher: decomposer NOT called (finisher returns early)', () => {
    // Finisher takes priority on follower path too — and the decomposer
    // was already skipped for the follower path.
    const hand: Card[] = [c('5', 'hearts'), c('5', 'spades')];
    const target = analyzeHand([c('3', 'hearts'), c('3', 'spades')], '2');
    if (!target) throw new Error('expected target');
    chooseMediumMove(hand, { ...baseCtx, target, myHandCount: 2 });
    expect(mocks.decomposeHand).not.toHaveBeenCalled();
  });
});
