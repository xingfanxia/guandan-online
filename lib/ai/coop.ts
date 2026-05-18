// Partner cooperation decision — shared by Medium + Hard bot tiers.
//
// In 4P Guandan, you're paired with a teammate (positions 1-3 vs 2-4 OR
// 1-2 vs 3-4 depending on seat layout). A core skill is recognizing when
// to DEFER to your partner rather than try to win the trick yourself —
// because Guandan rewards "double-down" finishes (1st + 2nd from same team
// = +3 level upgrade).
//
// This module exposes pure decision functions; the bot dispatch (medium.ts /
// hard.ts) consumes them. They take the minimal information needed and
// return a cooperation directive that the caller folds into its choice.

import type { PlayerId } from '../game/round';
import type { Pattern } from '../game/patterns';
import { powerRank } from '../game/patterns';
import type { LevelRank } from '../game/levels';

export interface CoopContext {
  /** Who currently leads / made the last play. */
  lastPlayer: PlayerId | null;
  /** My player id. */
  me: PlayerId;
  /** My partner's player id (4P always has exactly one partner). */
  partner: PlayerId;
  /** Card counts left in opponents' + partner's hand. */
  partnerHandCount: number;
  opponentHandCounts: readonly number[];
  /** Current level (for wildcard / level-card power). */
  levelRank: LevelRank;
  /** Number of cards in my own hand. */
  myHandCount: number;
}

export type CoopAdvice =
  | { kind: 'defer' }    // Defer to partner — pass or play cheapest dud.
  | { kind: 'cover' }    // Partner is dropping out — make space, play medium.
  | { kind: 'compete' }; // No cooperation signal — play optimally to win.

/**
 * Decide whether to defer to partner. Heuristics (in priority order):
 *
 * 1. Partner just led / just won the trick — DEFER. Don't beat your own
 *    teammate; they're trying to clear cards.
 * 2. Partner is near-finished (≤ 4 cards) and any opponent is far behind
 *    (≥ 8 cards) — COVER. Burn medium-strength cards to deny opponents
 *    setting up sweeps.
 * 3. Otherwise — COMPETE.
 */
export function decidePartnerCoop(ctx: CoopContext): CoopAdvice {
  // Rule 1: partner just led/won the trick → DEFER.
  if (ctx.lastPlayer === ctx.partner) return { kind: 'defer' };

  // Rule 2: partner near out + opponent has many cards → COVER.
  const opponentMaxLeft = Math.max(...ctx.opponentHandCounts, 0);
  if (ctx.partnerHandCount <= 4 && opponentMaxLeft >= 8) {
    return { kind: 'cover' };
  }

  // Rule 3: default → compete normally.
  return { kind: 'compete' };
}

/**
 * Filter / weight legal plays based on a CoopAdvice. Pure transformation;
 * returns a new pattern list (possibly empty) ordered by preferred play.
 *
 * - 'defer': prefer cheapest non-bomb plays; drop bombs/jokerBombs entirely.
 *   If list empty after filtering, return original (caller decides pass).
 * - 'cover': prefer medium-strength plays (cheap bombs OK; trim absurdly
 *   expensive ones like jokerBombs).
 * - 'compete': return as-is.
 */
export function rankByCoop(
  plays: readonly Pattern[],
  advice: CoopAdvice,
  levelRank: LevelRank,
): Pattern[] {
  const arr = plays.slice();
  if (advice.kind === 'defer') {
    const noBombs = arr.filter((p) => p.kind !== 'bomb' && p.kind !== 'jokerBomb');
    return noBombs.length > 0 ? sortByCost(noBombs, levelRank) : sortByCost(arr, levelRank);
  }
  if (advice.kind === 'cover') {
    const noJoker = arr.filter((p) => p.kind !== 'jokerBomb');
    return noJoker.length > 0 ? sortByCost(noJoker, levelRank) : sortByCost(arr, levelRank);
  }
  return sortByCost(arr, levelRank);
}

function sortByCost(plays: Pattern[], levelRank: LevelRank): Pattern[] {
  return plays.slice().sort((a, b) => costOf(a, levelRank) - costOf(b, levelRank));
}

function costOf(p: Pattern, levelRank: LevelRank): number {
  if (p.kind === 'jokerBomb') return 100_000;
  if (p.kind === 'bomb') return 80_000 + p.length * 100 + (p.rank === levelRank ? 14 : 0);
  if (p.kind === 'flushStraight') return 75_000;
  if (p.rank === null) return 50_000;
  return powerRank(p.rank, levelRank);
}
