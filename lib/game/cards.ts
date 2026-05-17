// Card primitives — 108-card double deck with deterministic shuffle + deal.
//
// Semantics follow docs/research/game-rules.md § "Cards & deck" verbatim:
// - 2 × standard 54-card deck (52 natural + 2 jokers per deck)
// - 4 suits (♠♥♣♦), 13 natural ranks (2 through A), 2 joker ranks (BJ small, RJ big)
// - Each card carries deck: 1 | 2 to distinguish identical copies
//
// The 红心级牌 (heart-suit current-level wildcard) is identified at runtime
// via isWildcard(card, levelRank) — the card data itself doesn't carry a
// wildcard flag, since "wildcard" is contextual to the current level.

import type { LevelRank } from './levels';

export type NaturalSuit = 'spades' | 'hearts' | 'clubs' | 'diamonds';
export type Suit = NaturalSuit | 'joker';

export type NaturalRank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
export type JokerRank = 'BJ' | 'RJ'; // BJ = Black/Small Joker 小王; RJ = Red/Big Joker 大王
export type Rank = NaturalRank | JokerRank;

export type DeckId = 1 | 2;

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
  readonly deck: DeckId;
}

export const NATURAL_SUITS: readonly NaturalSuit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
export const NATURAL_RANKS: readonly NaturalRank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];
export const JOKER_RANKS: readonly JokerRank[] = ['BJ', 'RJ'];

/** 108 cards: 52 naturals + 2 jokers per deck, two decks. */
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (const deck of [1, 2] as const) {
    for (const suit of NATURAL_SUITS) {
      for (const rank of NATURAL_RANKS) {
        cards.push({ suit, rank, deck });
      }
    }
    cards.push({ suit: 'joker', rank: 'BJ', deck });
    cards.push({ suit: 'joker', rank: 'RJ', deck });
  }
  return cards;
}

/**
 * Fisher-Yates shuffle. Pure (returns a new array, does not mutate input).
 * Caller supplies the RNG — production passes Math.random, tests pass
 * a seeded RNG (seedrandom) for determinism.
 */
export function shuffleDeck(deck: readonly Card[], rng: () => number): Card[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Deal a shuffled deck into N hands. 4P → 27 each, 6P → 18 each, 8P → 13 each
 * (with 4 cards remaining face-down per game-rules.md).
 *
 * Returns one hand per player, each sorted by stable insertion order. Caller
 * is responsible for any per-player sort/arrange.
 *
 * Throws if deck size is not 108 — engine must use the canonical double deck.
 */
export function deal(deck: readonly Card[], playerCount: 4 | 6 | 8): Card[][] {
  if (deck.length !== 108) {
    throw new Error(`deal: expected 108-card deck, got ${deck.length}`);
  }
  const perPlayer = playerCount === 4 ? 27 : playerCount === 6 ? 18 : 13;
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  for (let i = 0; i < perPlayer * playerCount; i++) {
    hands[i % playerCount]!.push(deck[i]!);
  }
  return hands;
}

/** Cards left aside in 8P (108 − 8×13 = 4); empty for 4P/6P. */
export function undealtCards(deck: readonly Card[], playerCount: 4 | 6 | 8): Card[] {
  if (deck.length !== 108) {
    throw new Error(`undealtCards: expected 108-card deck, got ${deck.length}`);
  }
  const perPlayer = playerCount === 4 ? 27 : playerCount === 6 ? 18 : 13;
  return deck.slice(perPlayer * playerCount);
}

/**
 * True if `card` is the heart-suit wildcard (红心级牌 / 逢人配) for the given
 * current level. There are 2 such cards in play (one per deck) when the level
 * is a natural rank; level-2 is the most common opening level.
 *
 * Jokers are never wildcards — they're already jokers. The wildcard contract
 * (game-rules.md §wildcard rule 4) explicitly forbids substituting wildcard
 * for joker.
 */
export function isWildcard(card: Card, levelRank: LevelRank): boolean {
  return card.suit === 'hearts' && card.rank === levelRank;
}
