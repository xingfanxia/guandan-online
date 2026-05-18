// Bomb detection + power hierarchy.
//
// SYNC: docs/research/game-rules.md § "Bomb hierarchy (炸弹等级)" lines ~134-160
// and § "Card types" rows 8-10 (flushStraight / bomb / jokerBomb).
//
// Power tiers (weakest → strongest):
//   1. 4-card rank bomb       (炸弹 4)
//   2. 5-card rank bomb       (炸弹 5)
//   3. Flush straight         (同花顺, 5 cards)
//   4. 6-card rank bomb       (炸弹 6)
//   5. 7-card rank bomb       (炸弹 7)
//   6. 8-card rank bomb       (炸弹 8 — max non-joker)
//   7. Joker bomb / 天王炸     (4 jokers: 2 BJ + 2 RJ)
//
// Within-tier ordering: rank bombs use level-aware rank value (level rank lifts
// to 14, above A). Flush straights use the natural high-card value (level does
// NOT lift inside a sequence — see game-rules.md § "Level rank").
//
// Wildcard substitution (rule 6): wildcards complete bombs but do NOT change
// the bomb's natural rank for comparison.

import { partitionWildcards } from './wildcard';
import type { Card, NaturalRank, NaturalSuit } from './cards';
import type { LevelRank } from './levels';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BombKind = 'rank' | 'flushStraight' | 'jokerBomb';

export interface RankBomb {
  kind: 'rank';
  rank: NaturalRank;
  length: 4 | 5 | 6 | 7 | 8;
  cards: readonly Card[];
}

export interface FlushStraightBomb {
  kind: 'flushStraight';
  rank: NaturalRank; // highest card in the 5-window
  suit: NaturalSuit;
  cards: readonly Card[];
}

export interface JokerBomb {
  kind: 'jokerBomb';
  cards: readonly Card[];
}

export type Bomb = RankBomb | FlushStraightBomb | JokerBomb;

// ─── Power tiers ──────────────────────────────────────────────────────────────

/** Returns the power tier (1..7). Higher beats lower regardless of rank. */
export function bombPower(bomb: Bomb): number {
  if (bomb.kind === 'jokerBomb') return 7;
  if (bomb.kind === 'flushStraight') return 3;
  // rank bomb — by length
  if (bomb.length >= 8) return 6;
  if (bomb.length === 7) return 5;
  if (bomb.length === 6) return 4;
  if (bomb.length === 5) return 2;
  return 1; // length 4
}

// ─── Rank values (within-tier comparison) ─────────────────────────────────────

const NATURAL_RANK_VALUE: Record<NaturalRank, number> = {
  '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7,
  '9': 8, '10': 9, J: 10, Q: 11, K: 12, A: 13,
};

/**
 * Returns the within-tier rank value used to break ties at the same power.
 * - Rank bomb: 1..13, level-rank lifts to 14.
 * - Flush straight: natural high-card value (1..13); level does NOT lift.
 * - Joker bomb: 0 (ties only with itself).
 */
export function bombRankValue(bomb: Bomb, levelRank: LevelRank): number {
  if (bomb.kind === 'jokerBomb') return 0;
  if (bomb.kind === 'rank' && bomb.rank === levelRank) return 14;
  return NATURAL_RANK_VALUE[bomb.rank];
}

// ─── Comparison ───────────────────────────────────────────────────────────────

/** Strict -1/0/1 comparison; a beats b → 1, ties → 0, a loses → -1. */
export function compareBombs(a: Bomb, b: Bomb, levelRank: LevelRank): -1 | 0 | 1 {
  const pa = bombPower(a);
  const pb = bombPower(b);
  if (pa > pb) return 1;
  if (pa < pb) return -1;
  const ra = bombRankValue(a, levelRank);
  const rb = bombRankValue(b, levelRank);
  if (ra > rb) return 1;
  if (ra < rb) return -1;
  return 0;
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Identify whether a card set forms a bomb. Returns the strongest valid
 * interpretation, or null if no bomb interpretation exists.
 *
 * Order of attempts (per game-rules.md hierarchy):
 *   1. Joker bomb (only on 4 cards)
 *   2. Rank bomb (4..8 cards)
 *   3. Flush straight (only on 5 cards)
 *
 * Two interpretations cannot both be valid on the same card set:
 *   - Joker bomb requires 4 jokers; a rank/flush bomb cannot also have jokers.
 *   - Rank bomb requires single-rank naturals; a flush straight has distinct ranks.
 */
export function detectBomb(cards: readonly Card[], levelRank: LevelRank): Bomb | null {
  if (cards.length < 4 || cards.length > 8) return null;

  if (cards.length === 4) {
    const jb = tryJokerBomb(cards);
    if (jb) return jb;
  }

  const rb = tryRankBomb(cards, levelRank);
  if (rb) return rb;

  if (cards.length === 5) {
    const fs = tryFlushStraight(cards, levelRank);
    if (fs) return fs;
  }

  return null;
}

function tryJokerBomb(cards: readonly Card[]): JokerBomb | null {
  if (cards.length !== 4) return null;
  let bj = 0;
  let rj = 0;
  for (const card of cards) {
    if (card.rank === 'BJ') bj++;
    else if (card.rank === 'RJ') rj++;
    else return null;
  }
  if (bj === 2 && rj === 2) return { kind: 'jokerBomb', cards };
  return null;
}

function tryRankBomb(cards: readonly Card[], levelRank: LevelRank): RankBomb | null {
  const { wildcards, naturals } = partitionWildcards(cards, levelRank);
  if (naturals.length === 0) return null; // all wildcards: ≤ 2 cards, never ≥ 4

  const first = naturals[0]!;
  if (first.suit === 'joker') return null; // jokers in non-joker bomb invalid

  const targetRank = first.rank as NaturalRank;
  for (const n of naturals) {
    if (n.rank !== targetRank) return null;
    if (n.suit === 'joker') return null;
  }

  // wildcards declare themselves as targetRank — game-rules rule 6: they
  // contribute to the bomb without lifting it. Wildcard count is implicitly
  // bounded by the deck (max 2), but tryRankBomb does not enforce that —
  // upstream the deck constraint is the cards array itself.
  void wildcards; // intentional — wildcards just fill rank-matched slots

  return {
    kind: 'rank',
    rank: targetRank,
    length: cards.length as RankBomb['length'],
    cards,
  };
}

// 5-card consecutive windows. A can act as low (in A-2-3-4-5) or high (in
// 10-J-Q-K-A), but not both in the same straight — no wrap windows.
// Ordered low-to-high; iteration is reversed in tryFlushStraight to pick the
// largest interpretation per wildcard rule 2 ("defaults to largest hand").
const FLUSH_STRAIGHT_WINDOWS: readonly (readonly NaturalRank[])[] = [
  ['A', '2', '3', '4', '5'],
  ['2', '3', '4', '5', '6'],
  ['3', '4', '5', '6', '7'],
  ['4', '5', '6', '7', '8'],
  ['5', '6', '7', '8', '9'],
  ['6', '7', '8', '9', '10'],
  ['7', '8', '9', '10', 'J'],
  ['8', '9', '10', 'J', 'Q'],
  ['9', '10', 'J', 'Q', 'K'],
  ['10', 'J', 'Q', 'K', 'A'],
];

function tryFlushStraight(
  cards: readonly Card[],
  levelRank: LevelRank
): FlushStraightBomb | null {
  if (cards.length !== 5) return null;
  const { wildcards, naturals } = partitionWildcards(cards, levelRank);

  // All naturals must share one suit, none can be a joker.
  let suit: NaturalSuit | null = null;
  for (const n of naturals) {
    if (n.suit === 'joker') return null;
    if (suit === null) {
      suit = n.suit;
    } else if (n.suit !== suit) {
      return null;
    }
  }
  if (suit === null) return null; // no naturals (impossible since wildcards ≤ 2 < 5)

  // Natural ranks must be distinct.
  const naturalRanks = naturals.map((n) => n.rank as NaturalRank);
  if (new Set(naturalRanks).size !== naturalRanks.length) return null;

  // Find the largest window whose holes match the wildcard count.
  for (let i = FLUSH_STRAIGHT_WINDOWS.length - 1; i >= 0; i--) {
    const window = FLUSH_STRAIGHT_WINDOWS[i]!;
    const allIn = naturalRanks.every((r) => window.includes(r));
    if (!allIn) continue;
    const holes = window.filter((r) => !naturalRanks.includes(r));
    if (holes.length === wildcards.length) {
      const highRank = window[window.length - 1]!;
      return { kind: 'flushStraight', rank: highRank, suit, cards };
    }
  }
  return null;
}
