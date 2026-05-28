// Player assistance — auto-sort (理牌) grouping (AI-3).
//
// Wraps lib/game/handSort.sortHand (descending power, then suit, then deck)
// and additionally groups the sorted hand into combo CLUSTERS for display —
// consecutive same-rank cards form a cluster (single / pair / triple / 炸).
// This lets the UI render visual gaps between groups so the human can read
// their hand at a glance.
//
// Pure-functional: returns new arrays, never mutates the input.
//
// Wildcards (红心级牌) sort to power 14 (just below jokers) via sortHand, so
// they cluster with other level-rank cards — which is the correct visual
// default (a wildcard reads as the level card until the player commits it to
// a combo).

import type { Card } from '@lib/game/cards';
import type { LevelRank } from '@lib/game/levels';
import { sortHand } from '@lib/game/handSort';

/** A run of consecutive same-rank cards in the sorted hand. */
export interface SortCluster {
  /** The shared rank of every card in this cluster. */
  readonly rank: Card['rank'];
  /** Cards in this cluster (sorted slice of the hand). */
  readonly cards: readonly Card[];
  /**
   * Flat index of this cluster's first card in the sorted hand. Lets the
   * caller map a cluster back to liftedIndices on the flat <Hand /> render.
   */
  readonly startIndex: number;
}

export interface SortResult {
  /** The fully sorted hand (descending power) — feed to the reorder callback. */
  readonly sorted: readonly Card[];
  /** Same cards, partitioned into same-rank clusters for grouped display. */
  readonly clusters: readonly SortCluster[];
}

/**
 * Sort `hand` and group it into same-rank clusters.
 *
 * Deterministic: identical inputs always produce identical clusters, because
 * sortHand is a total order over (power, suit, deck).
 */
export function sortAndGroup(
  hand: readonly Card[],
  levelRank: LevelRank,
): SortResult {
  const sorted = sortHand(hand, levelRank);
  const clusters: SortCluster[] = [];

  let i = 0;
  while (i < sorted.length) {
    const rank = sorted[i]!.rank;
    let j = i + 1;
    while (j < sorted.length && sorted[j]!.rank === rank) j++;
    clusters.push({
      rank,
      cards: sorted.slice(i, j),
      startIndex: i,
    });
    i = j;
  }

  return { sorted, clusters };
}
