// Tests for the Bobgy decomposer integration in chooseMediumMove.
// Kept in a separate file from medium.test.ts so the WASM preload here
// doesn't leak into tests that exercise the heuristic-only fallback.

import { describe, it, expect, beforeAll } from 'vitest';
import { chooseMediumMove, type MediumContext } from '@lib/ai/medium';
import type { Card } from '@lib/game/cards';
import { analyzeHand } from '@lib/game/patterns';
import { preloadDecomposer } from '@lib/ai/decomposer';

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

describe('chooseMediumMove — with decomposer preloaded', () => {
  beforeAll(async () => {
    await preloadDecomposer();
  });

  it('uses decomposer suggestion when it matches a legal leader play', () => {
    // Hand: 5-card straight + an orphan Q. The decomposer recognizes the
    // straight as the high-value structure and suggests playing the
    // orphan single Q FIRST (so the straight remains intact for later).
    // The pure-heuristic path would have picked the cheapest single
    // (the 4) instead. Asserting rank='Q' isolates the decomposer path.
    const hand: Card[] = [
      c('4', 'spades'), c('5', 'hearts'), c('6', 'clubs'),
      c('7', 'diamonds'), c('8', 'spades'),
      c('Q', 'hearts'),
    ];
    const move = chooseMediumMove(hand, { ...baseCtx, target: null, myHandCount: 6 });
    expect(move.kind).toBe('play');
    if (move.kind === 'play') {
      expect(move.pattern.cards).toHaveLength(1);
      expect(move.pattern.rank).toBe('Q');
    }
  });

  it('falls back to heuristic when decomposer suggestion is illegal as a response', () => {
    // Follower facing a pair of Ks. Decomposer's standalone-hand
    // suggestion is going to be a structural play (pair / single) that
    // can't beat the K pair. Heuristic correctly identifies "no legal
    // beat exists" → pass. Validates the fallback contract: when the
    // decomposer's suggestion isn't in the enumerated legal plays, the
    // heuristic still runs.
    const hand: Card[] = [c('3', 'hearts'), c('3', 'spades')];
    const target = analyzeHand([c('K', 'hearts'), c('K', 'spades')], '2');
    if (!target || target.kind !== 'pair') throw new Error('expected pair target');
    const move = chooseMediumMove(hand, { ...baseCtx, target });
    expect(move.kind).toBe('pass');
  });

  it('endgame finisher takes priority over decomposer suggestion', () => {
    // Hand is exactly a pair (myHandCount === 2). The finisher check
    // fires before the decomposer call, so even if the decomposer
    // suggested something weird, we go out.
    const hand: Card[] = [c('10', 'hearts'), c('10', 'spades')];
    const move = chooseMediumMove(hand, { ...baseCtx, target: null, myHandCount: 2 });
    expect(move.kind).toBe('play');
    if (move.kind === 'play') {
      expect(move.pattern.cards).toHaveLength(2);
    }
  });

  it('defer policy still wins over decomposer suggestion', () => {
    // Partner just won; we have a legal beat that's NOT a finisher.
    // Defer policy passes regardless of what the decomposer suggests.
    const hand: Card[] = [
      c('5', 'hearts'), c('5', 'spades'),
      c('9', 'clubs'), c('10', 'diamonds'),
    ];
    const target = analyzeHand([c('3', 'hearts'), c('3', 'spades')], '2');
    if (!target) throw new Error('expected target');
    const move = chooseMediumMove(hand, {
      ...baseCtx,
      target,
      lastPlayer: 'partner',
      myHandCount: 4,
    });
    expect(move.kind).toBe('pass');
  });

  it('falls back to heuristic when decomposer dumps the whole hand as one section', () => {
    // Some hands (no exploitable pattern + mixed ranks) make Bobgy's
    // DFS solver bottom out at the fallback that emits the entire
    // remaining hand as one section. That section isn't a legal Guandan
    // pattern, so cardsMatch fails against any enumerated single play,
    // and the heuristic takes over and picks the cheapest single.
    const hand: Card[] = [
      c('3', 'hearts'), c('3', 'spades'),
      c('K', 'clubs'), c('K', 'diamonds'),
      c('5', 'hearts'),
    ];
    const move = chooseMediumMove(hand, { ...baseCtx, target: null, myHandCount: 5 });
    expect(move.kind).toBe('play');
    if (move.kind === 'play') {
      // Heuristic picks cheapest single — rank '3' (lower than '5' or 'K').
      expect(move.pattern.cards).toHaveLength(1);
      expect(move.pattern.rank).toBe('3');
    }
  });
});
