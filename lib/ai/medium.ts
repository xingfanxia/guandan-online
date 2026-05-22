// Medium AI tier — rule-based + partner-aware + Bobgy decomposer suggestion.
//
// Strategy vs Easy:
//   - No 30% random noise; always plays the best available choice.
//   - Partner cooperation: if partner just led/won, DEFER (pass or
//     small dud). If partner is close to finishing while opponents are
//     far behind, COVER (deny opponents, burn medium cards).
//   - Endgame: when within 1 play of empty, prefer plays that fully
//     clear the hand.
//   - Decomposer (Bobgy DFS solver) suggests the optimal first play for
//     the standalone hand. When the suggestion matches a legal response
//     to the current trick, we play it; otherwise we fall back to the
//     rule-based heuristic. Endgame finisher + defer policy always take
//     priority over the decomposer (which doesn't model trick context
//     or cooperation).
//
// The decomposer is opt-in: callers should `await preloadDecomposer()`
// once at startup. When the module isn't loaded yet, decomposeHand
// returns null and we transparently fall back to the heuristic.

import type { Card } from '../game/cards.js';
import { enumerateLegalPlays } from './enumerate.js';
import type { Pattern } from '../game/patterns.js';
import { decidePartnerCoop, rankByCoop, type CoopContext } from './coop.js';
import { decomposeHand } from './decomposer/index.js';
import type { LevelRank } from '../game/levels.js';

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

  // Leader: must play. Endgame finisher → decomposer → heuristic.
  if (ctx.target === null) {
    if (plays.length === 0) {
      throw new Error('chooseMediumMove: leading with no legal plays — caller bug');
    }
    const finisher = plays.find((p) => p.cards.length === hand.length);
    if (finisher) return { kind: 'play', pattern: finisher };
    const decompMatch = tryDecomposerMatch(hand, ctx.levelRank, plays);
    if (decompMatch) return { kind: 'play', pattern: decompMatch };
    const advice = decidePartnerCoop(ctx);
    const ranked = rankByCoop(plays, advice, ctx.levelRank);
    return { kind: 'play', pattern: ranked[0]! };
  }

  // Follower: cannot play → pass.
  if (plays.length === 0) return { kind: 'pass' };

  const advice = decidePartnerCoop(ctx);

  // 'defer' — pass unless a clear endgame finisher is available. The
  // decomposer doesn't override cooperation policy.
  if (advice.kind === 'defer') {
    const finisher = plays.find((p) => p.cards.length === hand.length);
    if (finisher) return { kind: 'play', pattern: finisher };
    return { kind: 'pass' };
  }

  // Endgame finisher takes priority over decomposer + heuristic.
  const finisher = plays.find((p) => p.cards.length === hand.length);
  if (finisher) return { kind: 'play', pattern: finisher };

  // G-I3: skip decomposer on follower turns. Its first-play suggestion is
  // target-blind (built from the standalone hand without considering the
  // current trick), so the result almost never matches the target — the
  // CPU spent on the WASM call is wasted. Fall directly through to the
  // cooperation-ranked heuristic.
  const ranked = rankByCoop(plays, advice, ctx.levelRank);
  return { kind: 'play', pattern: ranked[0]! };
}

/**
 * Run the decomposer and try to find an enumerated legal play matching
 * its top suggestion. Returns null when the decomposer isn't loaded,
 * returns no solution, or its first play isn't representable as a single
 * legal play in the current trick context.
 */
function tryDecomposerMatch(
  hand: readonly Card[],
  levelRank: LevelRank,
  legalPlays: readonly Pattern[],
): Pattern | null {
  const decomp = decomposeHand(hand, levelRank);
  if (!decomp || decomp.plays.length === 0) return null;
  const firstPlay = decomp.plays[0]!;
  return legalPlays.find((p) => cardsMatch(p.cards, firstPlay.cards)) ?? null;
}

/** Multiset equality by (suit, rank, deck) — order independent. */
function cardsMatch(a: readonly Card[], b: readonly Card[]): boolean {
  if (a.length !== b.length) return false;
  const key = (c: Card): string => `${c.rank}-${c.suit}-${c.deck}`;
  const aKeys = a.map(key).sort();
  const bKeys = b.map(key).sort();
  return aKeys.every((k, i) => k === bKeys[i]);
}
