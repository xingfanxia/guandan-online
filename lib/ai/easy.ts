// Easy AI tier — picks legal plays with 30% noise injection.
//
// Strategy:
//   1. Leader: play the LOWEST-cost legal pattern (preserve high cards).
//   2. Follower:
//      - 30% noise: random play (50/50: pass vs random legal play)
//      - 70% baseline: play the lowest-cost beating play, or pass if none.
//
// Cost ordering puts bombs last so the bot doesn't burn a bomb on a trivial
// trick. Within the same family, lower rank = lower cost.
//
// Future tiers (AI-2 Medium): WASM solver for rounds-to-empty-hand + partner
// cooperation. Hard tier (AI-3): LLM-guided. Both share this enumerate +
// canBeat foundation.

import type { Card } from '../game/cards';
import { enumerateLegalPlays } from './enumerate';
import type { Pattern } from '../game/patterns';
import { powerRank } from '../game/patterns';
import type { LevelRank } from '../game/levels';

export type EasyMove =
  | { kind: 'play'; pattern: Pattern }
  | { kind: 'pass' };

const NOISE_RATE = 0.3;
const NOISE_PASS_RATE = 0.5; // within noise: 50% pass, 50% random play

export function chooseEasyMove(
  hand: readonly Card[],
  target: Pattern | null,
  levelRank: LevelRank,
  rng: () => number = Math.random
): EasyMove {
  const plays = enumerateLegalPlays(hand, target, levelRank);

  // Leader: must play something — pick cheapest.
  if (target === null) {
    if (plays.length === 0) {
      throw new Error(
        'chooseEasyMove: leading with no legal plays (empty hand?) — caller bug'
      );
    }
    return { kind: 'play', pattern: pickCheapest(plays, levelRank) };
  }

  // Follower with no legal play → pass.
  if (plays.length === 0) return { kind: 'pass' };

  // 30% noise: random behavior.
  if (rng() < NOISE_RATE) {
    if (rng() < NOISE_PASS_RATE) return { kind: 'pass' };
    const idx = Math.floor(rng() * plays.length);
    return { kind: 'play', pattern: plays[idx]! };
  }

  // Baseline: cheapest beating play.
  return { kind: 'play', pattern: pickCheapest(plays, levelRank) };
}

function pickCheapest(plays: Pattern[], levelRank: LevelRank): Pattern {
  let best = plays[0]!;
  let bestCost = patternCost(best, levelRank);
  for (let i = 1; i < plays.length; i++) {
    const cost = patternCost(plays[i]!, levelRank);
    if (cost < bestCost) {
      best = plays[i]!;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * Pattern cost — used to rank legal plays from "cheapest" to "most valuable".
 * Cheap plays first: small singles before big singles, non-bombs before bombs,
 * smaller bombs before bigger bombs, joker-bomb last.
 *
 * The number scheme is not strictly principled; it just provides a stable
 * ordering. Adjusting the constants doesn't change correctness.
 */
function patternCost(p: Pattern, levelRank: LevelRank): number {
  if (p.kind === 'jokerBomb') return 100_000;
  if (p.kind === 'bomb') return 80_000 + p.length * 100 + (p.rank === levelRank ? 14 : 0);
  if (p.kind === 'flushStraight') return 75_000;
  // Non-bomb: cost = pattern rank * (kind weight). Lower rank = lower cost.
  if (p.rank === null) return 50_000;
  return powerRank(p.rank, levelRank);
}
