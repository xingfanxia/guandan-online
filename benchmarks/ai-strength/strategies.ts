// AI-strength benchmark — strategy adapters.
//
// A Strategy maps a seat's view of the round to a decision. Easy/Medium wrap
// the production dispatcher (lib/ai/dispatch.ts); `random` is a uniform-legal
// baseline used as the floor of the strength ladder. The benchmark proves
// medium > easy > random — the brief's core claim that "AI quality matters".

import type { Card } from '@lib/game/cards.js';
import type { LevelRank } from '@lib/game/levels.js';
import type { Pattern } from '@lib/game/patterns.js';
import type { PlayerId } from '@lib/game/round.js';
import { computeBotMove, type BotContext, type BotDecision } from '@lib/ai/dispatch.js';
import { enumerateLegalPlays } from '@lib/ai/enumerate.js';

export interface SeatView {
  hand: readonly Card[];
  /** Pattern to beat; null when leading. */
  target: Pattern | null;
  levelRank: LevelRank;
  lastPlayer: PlayerId | null;
  me: PlayerId;
  partner: PlayerId;
  partnerHandCount: number;
  opponentHandCounts: readonly number[];
  rng: () => number;
}

export type Strategy = (view: SeatView) => BotDecision;

function toCtx(view: SeatView, tier: 'easy' | 'medium' | 'hard'): BotContext {
  return {
    tier,
    hand: view.hand,
    target: view.target,
    levelRank: view.levelRank,
    lastPlayer: view.lastPlayer,
    me: view.me,
    partner: view.partner,
    partnerHandCount: view.partnerHandCount,
    opponentHandCounts: view.opponentHandCounts,
    rng: view.rng,
  };
}

export const easyStrategy: Strategy = (view) => computeBotMove(toCtx(view, 'easy'));

export const mediumStrategy: Strategy = (view) =>
  computeBotMove(toCtx(view, 'medium'));

export const hardStrategy: Strategy = (view) => computeBotMove(toCtx(view, 'hard'));

/**
 * Uniform-random legal play. When leading, plays a random legal pattern
 * (always ≥1 since every single card is legal). When following, picks
 * uniformly among legal beats plus the option to pass.
 */
export const randomStrategy: Strategy = (view) => {
  const plays = enumerateLegalPlays(view.hand, view.target, view.levelRank);
  if (view.target === null) {
    // Leading — must play. enumerate always returns ≥1 for a non-empty hand.
    const i = Math.floor(view.rng() * plays.length);
    return { kind: 'play', pattern: plays[i] ?? plays[0]! };
  }
  // Following — pass is the (plays.length)-th option.
  const i = Math.floor(view.rng() * (plays.length + 1));
  if (i >= plays.length) return { kind: 'pass' };
  return { kind: 'play', pattern: plays[i]! };
};

export const STRATEGIES: Record<string, Strategy> = {
  easy: easyStrategy,
  medium: mediumStrategy,
  hard: hardStrategy,
  random: randomStrategy,
};
