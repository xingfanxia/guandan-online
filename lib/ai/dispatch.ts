// Bot dispatcher — single entry point for "compute the bot's next move".
//
// Used by the move handler to evaluate bot turns inline: after a human move
// commits, while next-turn-is-bot the handler calls computeBotMove() and
// publishes the resulting move_played / move_passed event, repeating until
// the turn lands on a human or every connected player is a bot (rare).
//
// Hard tier (LLM) lives in `lib/ai/hard.ts` and is loaded only when the
// caller passes `tier: 'hard'` — the LLM client adds an async path the
// other tiers don't need.

import type { Card } from '../game/cards';
import type { LevelRank } from '../game/levels';
import type { Pattern } from '../game/patterns';
import type { PlayerId } from '../game/round';
import { chooseEasyMove } from './easy';
import { chooseMediumMove } from './medium';
import { chooseHardMove, type GenerateInput, type GenerateResult } from './hard';
import type { BudgetClient } from './budget';
import { createMemoryBudgetClient } from './budget';

export type BotTier = 'easy' | 'medium' | 'hard';

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

/**
 * Synchronous dispatch for easy + medium tiers. Hard tier is async — call
 * `computeBotMoveAsync` instead when the caller supports awaits.
 */
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
    case 'hard':
      throw new Error(
        'computeBotMove: hard tier is async — call computeBotMoveAsync instead'
      );
  }
}

export interface BotContextAsync extends BotContext {
  /** LLM client. When omitted, hard tier degrades to medium silently. */
  generate?: (input: GenerateInput) => Promise<GenerateResult>;
  /** Budget guardrail. Defaults to an in-memory client (no persistence). */
  budget?: BudgetClient;
  /** Override `FEATURE_AI_HARD` env var. Tests pass true. */
  featureEnabled?: boolean;
  /** Hard-tier LLM timeout ms. Default 3000. */
  timeoutMs?: number;
}

/**
 * Async dispatch — handles all three tiers including hard.
 *
 * Hard tier path:
 *   - When `ctx.generate` is provided, defers to `chooseHardMove` (LLM with
 *     5 silent-fallback triggers including FEATURE_AI_HARD env, budget, and
 *     timeout).
 *   - When `ctx.generate` is missing, falls back to medium synchronously
 *     (matches the pre-async-wiring behavior in runBots).
 */
export async function computeBotMoveAsync(ctx: BotContextAsync): Promise<BotDecision> {
  if (ctx.tier !== 'hard') return computeBotMove(ctx);
  if (ctx.generate === undefined) {
    // No LLM client wired — fall back to medium-tier deterministic play.
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

  // Build a synthetic UserPromptContext from BotContext fields. Production
  // callers can provide richer prompt context by threading the round + seats
  // explicitly through a dedicated dispatcher — this default preserves the
  // hard-tier fallback path while degrading prompt fidelity gracefully.
  const opp1Cards = ctx.opponentHandCounts[0] ?? 0;
  const opp2Cards = ctx.opponentHandCounts[1] ?? 0;
  const prompt = {
    seat: 0,
    teamName: '红' as const,
    myLevel: ctx.levelRank,
    oppLevel: ctx.levelRank,
    isALevel: ctx.levelRank === 'A',
    partnerSeat: 0,
    partnerCards: ctx.partnerHandCount,
    opp1Seat: 0,
    opp1Cards,
    opp2Seat: 0,
    opp2Cards,
  };

  const hardArgs: Parameters<typeof chooseHardMove>[0] = {
    hand: ctx.hand,
    target: ctx.target,
    levelRank: ctx.levelRank,
    lastPlayer: ctx.lastPlayer,
    me: ctx.me,
    partner: ctx.partner,
    partnerHandCount: ctx.partnerHandCount,
    opponentHandCounts: ctx.opponentHandCounts,
    prompt,
    budget: ctx.budget ?? createMemoryBudgetClient(),
    generate: ctx.generate,
  };
  if (ctx.featureEnabled !== undefined) hardArgs.featureEnabled = ctx.featureEnabled;
  if (ctx.timeoutMs !== undefined) hardArgs.timeoutMs = ctx.timeoutMs;
  return chooseHardMove(hardArgs);
}
