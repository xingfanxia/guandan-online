// Wildcard helpers — 红心级牌 / 逢人配 (heart-suit current-level card).
//
// SYNC: docs/research/game-rules.md § "Heart-suit level card (红心级牌 / 逢人配)"
// (rules for wildcard use, lines ~70-92).
//
// The wildcard rule, summarized:
// - The ♥ card of the current level rank is universal — substitutes any non-joker card.
// - There are 2 such cards in play (one per deck) when the level is a natural rank.
// - Rule 4: a wildcard CANNOT substitute Big Joker or Small Joker.
// - Rule 6: a wildcard used in a bomb does not change the bomb's natural rank
//   (this constraint is enforced in patterns.ts at hand-analysis time, not here).
//
// This module exposes detection / partition helpers. The actual substitution
// algorithm (try possible assignments → pick highest-strength valid hand) lives
// in patterns.ts where it has access to all 10 pattern kinds.

import { isWildcard } from './cards';
import type { Card, JokerRank } from './cards';
import type { LevelRank } from './levels';

/** Ranks a wildcard can never declare (rule 4). Both jokers. */
export const WILDCARD_NEVER_RANKS: readonly JokerRank[] = ['BJ', 'RJ'];

/** Count of wildcards in a card array given the current level. 0, 1, or 2. */
export function countWildcards(cards: readonly Card[], levelRank: LevelRank): number {
  let n = 0;
  for (const card of cards) {
    if (isWildcard(card, levelRank)) n++;
  }
  return n;
}

/**
 * Split a card array into wildcards and naturals, preserving the relative
 * order within each partition. Does not mutate the input.
 *
 * Useful as the first step of hand analysis: separate the W wildcards from the
 * N − W naturals, then enumerate substitution candidates for the wildcards
 * within the pattern-validation loop.
 */
export function partitionWildcards(
  cards: readonly Card[],
  levelRank: LevelRank
): { wildcards: Card[]; naturals: Card[] } {
  const wildcards: Card[] = [];
  const naturals: Card[] = [];
  for (const card of cards) {
    if (isWildcard(card, levelRank)) {
      wildcards.push(card);
    } else {
      naturals.push(card);
    }
  }
  return { wildcards, naturals };
}
