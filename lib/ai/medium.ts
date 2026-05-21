// Medium AI tier — rule-based + partner-aware.
//
// Strategy vs Easy:
//   - No 30% random noise; always plays the best available choice.
//   - Partner cooperation: if partner just led/won, DEFER (pass or
//     small dud). If partner is close to finishing while opponents are
//     far behind, COVER (deny opponents, burn medium cards).
//   - Endgame: when within 6 cards of empty, prefer plays that fully
//     clear or set up a 1-card finish.
//
// WASM solver integration is deferred to a follow-up; the current
// implementation uses pure heuristic ranking (`coop.ts:rankByCoop`).
// Replacing pickBeating with a solver call requires only swapping the
// final pickFrom call; the dispatch surface stays the same.

import type { Card } from '../game/cards.js';
import { enumerateLegalPlays } from './enumerate.js';
import type { Pattern } from '../game/patterns.js';
import { decidePartnerCoop, rankByCoop, type CoopContext } from './coop.js';

export type MediumMove =
  | { kind: 'play'; pattern: Pattern }
  | { kind: 'pass' };

export interface MediumContext extends CoopContext {
  /** Current target trick to beat. null = leader. */
  target: Pattern | null;
}

export function chooseMediumMove(
  hand: readonly Card[],
  ctx: MediumContext,
): MediumMove {
  const plays = enumerateLegalPlays(hand, ctx.target, ctx.levelRank);

  // Leader: must play. Use coop advice to bias selection.
  if (ctx.target === null) {
    if (plays.length === 0) {
      throw new Error('chooseMediumMove: leading with no legal plays — caller bug');
    }
    const advice = decidePartnerCoop(ctx);
    const ranked = rankByCoop(plays, advice, ctx.levelRank);
    // Endgame: if we can play a pattern equal to remaining hand size, go out.
    const finisher = ranked.find((p) => p.cards.length === hand.length);
    return { kind: 'play', pattern: finisher ?? ranked[0]! };
  }

  // Follower: cannot play → pass.
  if (plays.length === 0) return { kind: 'pass' };

  const advice = decidePartnerCoop(ctx);

  // 'defer' — pass unless a clear endgame finisher is available.
  if (advice.kind === 'defer') {
    const finisher = plays.find((p) => p.cards.length === hand.length);
    if (finisher) return { kind: 'play', pattern: finisher };
    return { kind: 'pass' };
  }

  const ranked = rankByCoop(plays, advice, ctx.levelRank);
  // Endgame check first.
  const finisher = ranked.find((p) => p.cards.length === hand.length);
  if (finisher) return { kind: 'play', pattern: finisher };
  return { kind: 'play', pattern: ranked[0]! };
}
