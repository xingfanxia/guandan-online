// Player assistance — move suggestion (AI-3).
//
// Reuses the legal-play enumerator + a cooperation-aware ranking heuristic
// (the same primitives the Medium bot uses) to recommend ONE play for the
// human. Pure: no SSE, no network, no global singletons. Any engine call is
// dependency-injected so tests can swap a deterministic enumerator.
//
// Contract:
//   - Follower (target != null): return the cheapest legal beat, or null when
//     no legal follow exists (the human should pass).
//   - Leader (target == null): return a sensible lead. When the hand can be
//     emptied in one play, prefer that finisher; otherwise the cheapest
//     non-bomb lead (preserve bombs/jokers), falling back to cheapest overall.
//   - Empty hand → null.

import type { Card } from '@lib/game/cards';
import type { Pattern } from '@lib/game/patterns';
import { powerRank } from '@lib/game/patterns';
import type { LevelRank } from '@lib/game/levels';
import { enumerateLegalPlays } from '@lib/ai/enumerate';

/** Engine seam — defaults to the production enumerator, overridable in tests. */
export type EnumerateFn = (
  hand: readonly Card[],
  target: Pattern | null,
  levelRank: LevelRank,
) => Pattern[];

export interface SuggestOptions {
  /** Override the legal-play enumerator (tests inject deterministic plays). */
  enumerate?: EnumerateFn;
}

/**
 * Suggest the single best legal play for `hand` against `target`.
 *
 * Returns the recommended Pattern, or null when there is no legal play
 * (empty hand, or a follower with nothing that beats the target).
 */
export function suggestMove(
  hand: readonly Card[],
  target: Pattern | null,
  levelRank: LevelRank,
  opts: SuggestOptions = {},
): Pattern | null {
  if (hand.length === 0) return null;

  const enumerate = opts.enumerate ?? enumerateLegalPlays;
  const plays = enumerate(hand, target, levelRank);
  if (plays.length === 0) return null;

  // Endgame: if any single play empties the hand, recommend it outright —
  // clearing the hand is the win condition.
  const finisher = plays.find((p) => p.cards.length === hand.length);
  if (finisher) return finisher;

  // Follower — cheapest legal beat (don't overpay; preserve strength).
  if (target !== null) {
    return cheapest(plays, levelRank);
  }

  // Leader — prefer the cheapest NON-bomb lead so the human doesn't blow a
  // bomb on an opening. Fall back to cheapest overall if only bombs exist.
  const nonBombs = plays.filter((p) => !isBomb(p));
  if (nonBombs.length > 0) return cheapest(nonBombs, levelRank);
  return cheapest(plays, levelRank);
}

const BOMB_KINDS: ReadonlySet<Pattern['kind']> = new Set([
  'bomb',
  'flushStraight',
  'jokerBomb',
]);

function isBomb(p: Pattern): boolean {
  return BOMB_KINDS.has(p.kind);
}

function cheapest(plays: readonly Pattern[], levelRank: LevelRank): Pattern {
  let best = plays[0]!;
  let bestCost = costOf(best, levelRank);
  for (let i = 1; i < plays.length; i++) {
    const cost = costOf(plays[i]!, levelRank);
    if (cost < bestCost) {
      best = plays[i]!;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * Stable cost ordering (mirrors lib/ai/coop.ts costOf): non-bombs by
 * level-aware power, then bombs by size, joker-bomb last. Lower = cheaper =
 * preferred to lead/follow with.
 */
function costOf(p: Pattern, levelRank: LevelRank): number {
  if (p.kind === 'jokerBomb') return 100_000;
  if (p.kind === 'bomb') {
    return 80_000 + p.length * 100 + (p.rank === levelRank ? 14 : 0);
  }
  if (p.kind === 'flushStraight') return 75_000;
  return powerRank(p.rank!, levelRank);
}
