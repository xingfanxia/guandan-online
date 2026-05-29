// Hard AI tier — Bobgy decomposer + opponent-aware follower play.
//
// Strategy vs Medium (Hard is a strict superset of Medium's strengths):
//   1. DECOMPOSITION-AWARE FOLLOWING. Medium skips the decomposer when
//      following (its lead-suggestion is target-blind) and just plays the
//      coop-ranked cheapest beat. Hard instead scores each legal beat by the
//      decomposition size of the hand that REMAINS after it — preferring the
//      beat that keeps the hand most playable (fewest future plays to empty),
//      tie-broken by cheapest. This is a 1-ply structural lookahead Medium
//      lacks.
//   2. DENY-THE-FINISHER AGGRESSION. When an opponent is about to go out
//      (hand count ≤ DENY_THRESHOLD), Hard beats the trick to deny them the
//      lead even when Medium's cooperation policy would defer/pass — losing
//      the round to an opponent finishing is worse than spending a beat.
//   3. Otherwise inherits Medium's leader logic (finisher → decomposer → coop)
//      and endgame finisher priority.
//
// Like Medium, the decomposer is opt-in (`await preloadDecomposer()`); when
// it isn't loaded Hard degrades to Medium's behavior.

import type { Card } from '../game/cards.js';
import { enumerateLegalPlays } from './enumerate.js';
import { powerRank, type Pattern } from '../game/patterns.js';
import { decidePartnerCoop, rankByCoop } from './coop.js';
import { decomposeHand } from './decomposer/index.js';
import { chooseMediumMove, type MediumContext, type MediumMove } from './medium.js';

/** Opponent hand-count at/under which Hard switches to deny-the-finisher mode. */
const DENY_THRESHOLD = 2;

export type HardMove = MediumMove;
export type HardContext = MediumContext;

export function chooseHardMove(hand: readonly Card[], ctx: HardContext): HardMove {
  const plays = enumerateLegalPlays(hand, ctx.target, ctx.levelRank);

  // Leader: Hard inherits Medium's lead logic (finisher → decomposer → coop).
  //
  // Phase B note (2026-05-28): a strategically-ordered decomposition lead was
  // tried here and empirically REJECTED — three principled orderings of the
  // decomposer's groups (longest/highest-first, shed-low, opponent-aware) each
  // benchmarked 50.8% (61/120) vs Medium, statistically identical to leaving the
  // lead = Medium's. The decomposer's optimal decomposition, filtered to
  // enumerable legal leads, almost always presents ONE dominant lead that Medium
  // already plays, so heuristic reordering can't differentiate the tiers. A
  // decisive Hard>Medium needs genuine determinization lookahead (sample
  // opponent hands, search multiple tricks) — research-grade work deferred per
  // docs/plan/bobgy/PHASE-A.md §10. See docs/plan/bobgy/PHASE-B-FINDINGS.md.
  if (ctx.target === null) {
    return chooseMediumMove(hand, ctx);
  }

  // Follower with no legal beat → pass.
  if (plays.length === 0) return { kind: 'pass' };

  // Endgame finisher always wins.
  const finisher = plays.find((p) => p.cards.length === hand.length);
  if (finisher) return { kind: 'play', pattern: finisher };

  const advice = decidePartnerCoop(ctx);
  const opponentAboutToFinish = ctx.opponentHandCounts.some(
    (n) => n > 0 && n <= DENY_THRESHOLD
  );

  // Deny-the-finisher: an opponent is one or two cards from out. Beating the
  // trick (even a cooperative-defer situation) denies them the lead. Spend the
  // cheapest legal beat — just enough to take control.
  if (opponentAboutToFinish) {
    return { kind: 'play', pattern: cheapest(plays, ctx.levelRank) };
  }

  // Defer to a leading/winning partner unless an endgame finisher exists
  // (handled above) — same as Medium, the decomposer doesn't override coop.
  if (advice.kind === 'defer') {
    return { kind: 'pass' };
  }

  // Decomposition-aware beat selection: pick the legal beat whose REMAINING
  // hand decomposes into the fewest future plays. Falls back to the
  // coop-ranked heuristic when the decomposer can't score (not loaded /
  // wildcard cases).
  const best = bestByRemainingDecomposition(hand, plays, ctx.levelRank);
  if (best) return { kind: 'play', pattern: best };

  const ranked = rankByCoop(plays, advice, ctx.levelRank);
  return { kind: 'play', pattern: ranked[0]! };
}

/** Power of a pattern's rank; null-rank patterns (e.g. joker bomb) sort highest
 *  so they're never picked as the "cheapest" beat. */
function rankPower(p: Pattern, levelRank: HardContext['levelRank']): number {
  return p.rank === null ? Number.POSITIVE_INFINITY : powerRank(p.rank, levelRank);
}

/** Cheapest legal beat by pattern power (level-aware). */
function cheapest(plays: readonly Pattern[], levelRank: HardContext['levelRank']): Pattern {
  return [...plays].sort((a, b) => rankPower(a, levelRank) - rankPower(b, levelRank))[0]!;
}

const cardKey = (c: Card): string => `${c.suit}-${c.rank}-${c.deck}`;

/**
 * For each candidate beat, decompose the hand that remains after playing it;
 * pick the beat that minimizes the remaining decomposition's play count
 * (most-playable residual hand), tie-broken by cheapest beat. Returns null
 * when the decomposer can't score any candidate (caller falls back).
 */
function bestByRemainingDecomposition(
  hand: readonly Card[],
  plays: readonly Pattern[],
  levelRank: HardContext['levelRank']
): Pattern | null {
  let best: Pattern | null = null;
  let bestScore = Infinity;
  for (const play of plays) {
    const remaining = removeCards(hand, play.cards);
    const decomp = decomposeHand(remaining, levelRank);
    if (!decomp) continue; // unscorable (not loaded / wildcard) — skip
    const score = decomp.plays.length;
    if (
      score < bestScore ||
      (score === bestScore &&
        best !== null &&
        rankPower(play, levelRank) < rankPower(best, levelRank))
    ) {
      bestScore = score;
      best = play;
    }
  }
  return best;
}

/** Remove one occurrence of each of `toRemove` from `hand` (by card identity). */
function removeCards(hand: readonly Card[], toRemove: readonly Card[]): Card[] {
  const remove = new Map<string, number>();
  for (const c of toRemove) remove.set(cardKey(c), (remove.get(cardKey(c)) ?? 0) + 1);
  const out: Card[] = [];
  for (const c of hand) {
    const k = cardKey(c);
    const n = remove.get(k) ?? 0;
    if (n > 0) {
      remove.set(k, n - 1);
      continue;
    }
    out.push(c);
  }
  return out;
}
