// Bot dispatcher — single entry point for "compute the bot's next move".
//
// Used by the move handler to evaluate bot turns inline: after a human move
// commits, while next-turn-is-bot the handler calls computeBotMove() and
// publishes the resulting move_played / move_passed event, repeating until
// the turn lands on a human or every connected player is a bot (rare).
//
// v1 ships Easy + Medium only. Hard tier returns post-WASM via the Bobgy
// solver with deeper search depth (see docs/research/ai-strategies.md Repo 1).
// The previous LLM-backed Hard tier was deleted on 2026-05-19 — see
// HANDOFF.md 2026-05-19 entry for rationale.

import type { Card } from '../game/cards';
import type { LevelRank } from '../game/levels';
import type { Pattern } from '../game/patterns';
import type { PlayerId } from '../game/round';
import { chooseEasyMove } from './easy';
import { chooseMediumMove } from './medium';

export type BotTier = 'easy' | 'medium';

export type BotDecision =
  | { kind: 'play'; pattern: Pattern }
  | { kind: 'pass' };

export interface BotContext {
  tier: BotTier;
  hand: readonly Card[];
  /** Target trick to beat; null when leading. */
  target: Pattern | null;
  levelRank: LevelRank;
  /** Player id of whoever made the last play, if any. */
  lastPlayer: PlayerId | null;
  /** This bot's player id. */
  me: PlayerId;
  /** Partner's player id (4P always has exactly one). */
  partner: PlayerId;
  /** Card counts left for partner + opponents. */
  partnerHandCount: number;
  opponentHandCounts: readonly number[];
  /** Optional RNG injection (for tests + determinism). */
  rng?: () => number;
}

export function computeBotMove(ctx: BotContext): BotDecision {
  switch (ctx.tier) {
    case 'easy':
      return chooseEasyMove(ctx.hand, ctx.target, ctx.levelRank, ctx.rng);
    case 'medium':
      return chooseMediumMove(ctx.hand, {
        target: ctx.target,
        lastPlayer: ctx.lastPlayer,
        me: ctx.me,
        partner: ctx.partner,
        partnerHandCount: ctx.partnerHandCount,
        opponentHandCounts: ctx.opponentHandCounts,
        levelRank: ctx.levelRank,
        myHandCount: ctx.hand.length,
      });
  }
}
