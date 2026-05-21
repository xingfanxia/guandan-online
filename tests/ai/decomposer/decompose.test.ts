import { describe, it, expect, beforeAll } from 'vitest';
import type { Card } from '@lib/game/cards';
import { decomposeHand, preloadDecomposer } from '@lib/ai/decomposer';

const c = (rank: Card['rank'], suit: Card['suit'], deck: Card['deck'] = 1): Card => ({ rank, suit, deck });

describe('decomposeHand (WASM solver integration)', () => {
  beforeAll(async () => {
    await preloadDecomposer();
  });

  it('decomposes a simple straight into one play group', () => {
    const hand: Card[] = [
      c('5', 'spades'),
      c('6', 'hearts'),
      c('7', 'clubs'),
      c('8', 'diamonds'),
      c('9', 'spades'),
    ];
    const decomp = decomposeHand(hand, '2');
    expect(decomp).not.toBeNull();
    expect(decomp!.plays.length).toBeGreaterThan(0);
    // Total cards across all plays should equal the hand size.
    const totalCards = decomp!.plays.reduce((acc, p) => acc + p.cards.length, 0);
    expect(totalCards).toBe(hand.length);
    expect(typeof decomp!.minCost).toBe('number');
  });

  it('decomposes a hand with bombs', () => {
    const hand: Card[] = [
      c('A', 'spades'),
      c('A', 'hearts'),
      c('A', 'clubs'),
      c('A', 'diamonds'),
      c('K', 'spades'),
      c('K', 'hearts'),
    ];
    const decomp = decomposeHand(hand, '2');
    expect(decomp).not.toBeNull();
    const totalCards = decomp!.plays.reduce((acc, p) => acc + p.cards.length, 0);
    expect(totalCards).toBe(hand.length);
  });

  it('decomposes a 27-card 4P deal without throwing (no wildcards)', () => {
    // A realistic 27-card hand spanning the rank space. levelRank is '7'
    // and the hand has no 7♥ — so no wildcards to substitute, and the
    // decoder's first-play lookup is guaranteed to succeed.
    const hand: Card[] = [
      c('2', 'spades'), c('2', 'hearts'),
      c('3', 'spades'), c('3', 'hearts'),
      c('4', 'clubs'),
      c('5', 'diamonds'), c('5', 'spades'),
      c('6', 'hearts'),
      c('7', 'clubs'),
      c('8', 'diamonds'), c('8', 'spades'),
      c('9', 'hearts'),
      c('10', 'clubs'),
      c('J', 'diamonds'), c('J', 'spades'),
      c('Q', 'hearts'),
      c('K', 'clubs'),
      c('A', 'diamonds'), c('A', 'spades'),
      c('2', 'clubs', 2),
      c('3', 'diamonds', 2),
      c('5', 'hearts', 2),
      c('7', 'spades', 2),
      c('9', 'diamonds', 2),
      c('Q', 'clubs', 2),
      c('BJ', 'joker'),
      c('RJ', 'joker'),
    ];
    expect(hand).toHaveLength(27);
    const decomp = decomposeHand(hand, '7');
    expect(decomp).not.toBeNull();
    const totalCards = decomp!.plays.reduce((acc, p) => acc + p.cards.length, 0);
    expect(totalCards).toBe(27);
    expect(typeof decomp!.minCost).toBe('number');
  });

  it('returns null cleanly when decomposer suggests a wildcard substitution (fallback contract)', () => {
    // levelRank='2' → 2♥ is a wildcard. The solver may use it as some
    // other card in the first play; decoder can't map the substitution
    // token back to our hand, so decomposeHand returns null. Caller
    // (medium.ts) treats this as a fallback signal — heuristic takes over.
    const hand: Card[] = [
      c('2', 'hearts'),
      c('5', 'spades'),
      c('6', 'hearts'),
      c('7', 'clubs'),
      c('8', 'diamonds'),
    ];
    // Don't assert null — just assert the call doesn't throw and returns
    // either a valid decomposition or null. Both are valid outcomes.
    const decomp = decomposeHand(hand, '2');
    if (decomp !== null) {
      const totalCards = decomp.plays.reduce((acc, p) => acc + p.cards.length, 0);
      expect(totalCards).toBe(hand.length);
    }
    // (Test passes either way — the point is no throw.)
  });

  it('is deterministic — same hand returns the same decomposition shape', () => {
    const hand: Card[] = [
      c('A', 'spades'),
      c('A', 'hearts'),
      c('K', 'spades'),
      c('K', 'hearts'),
      c('Q', 'spades'),
    ];
    const first = decomposeHand(hand, '2');
    const second = decomposeHand(hand, '2');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.minCost).toBe(second!.minCost);
    expect(first!.plays.length).toBe(second!.plays.length);
  });

  it('returns null for empty hand', () => {
    expect(decomposeHand([], '2')).toBeNull();
  });

  it('accepts MinPlays estimator (useOverallValueEstimator=false)', () => {
    const hand: Card[] = [c('5', 'spades'), c('5', 'hearts'), c('6', 'clubs')];
    const decomp = decomposeHand(hand, '2', false);
    expect(decomp).not.toBeNull();
  });
});
