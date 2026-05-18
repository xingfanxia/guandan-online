// Bot run-loop — advances the round past any bot turns until landing on a human.
//
// Called by the /move handler after a human's move commits successfully.
// While the current player is a bot, this helper:
//   1. Starts the next trick if `currentTrick` is null (the prior trick just
//      ended). Note: startTrick emits no event — it's bookkeeping.
//   2. Builds a BotContext from the round + member's tier, calls
//      `computeBotMove()` to pick a play/pass.
//   3. Applies the decision via playCards()/pass() directly (no version /
//      auth checks — we trust our own dispatcher).
//   4. Derives events via `deriveMoveEvent`, assigning sequential versions
//      starting from `nextVersion`.
//   5. Repeats until the next player is a human, or the round finishes, or
//      a safety cap fires.
//
// Round-end and game-end events are NOT derived here — the move handler
// already detects `newRound.phase === 'finished'` and runs the session/
// round-end fanout once after all moves (human + bots) have landed.
//
// Hard tier is deferred: when a 'hard' bot's turn comes up we fall back to
// the medium tier so the run-loop stays synchronous. Real Hard tier dispatch
// (which is async via the LLM client) lands when AI-2 wires its async client
// through the move handler.

import { pass, playCards, startTrick } from '../game/round';
import type { GameRound, PlayerId } from '../game/round';
import type { RoomState } from '../room/lifecycle';
import { encodeCards } from '../realtime/cardCodec';
import { deriveMoveEvent } from '../realtime/deriveMoveEvent';
import type { AuthorEvent } from '../realtime/buildClientPayload';
import type { MoveCommand } from '../realtime/commands';
import type { ISOTimestamp } from '../realtime/messages';
import {
  computeBotMove,
  computeBotMoveAsync,
  type BotContext,
  type BotContextAsync,
  type BotTier,
} from './dispatch';
import type { GenerateInput, GenerateResult } from './hard';
import type { BudgetClient } from './budget';

export interface RunBotsInput {
  room: RoomState;
  round: GameRound;
  /** Version of the round AFTER the last emitted event (the move handler's
   * `response.appliedVersion` AFTER its initial deriveMoveEvent + trick_won). */
  startVersion: number;
  /** Turn deadline to stamp into emitted bot events. */
  turnDeadline: ISOTimestamp;
  /** Iteration cap. Defaults to 64 — far more than any plausible bot-only
   * sequence. */
  maxIterations?: number;
  /** RNG passthrough for Easy noise + Medium tie-breaks. Defaults to Math.random. */
  rng?: () => number;
}

export interface RunBotsAsyncInput extends RunBotsInput {
  /** LLM client for Hard tier. When omitted, hard degrades to medium. */
  generate?: (input: GenerateInput) => Promise<GenerateResult>;
  /** Budget client for Hard tier cost tracking. Defaults to in-memory. */
  budget?: BudgetClient;
  /** Override `FEATURE_AI_HARD` env var check. Tests pass true. */
  featureEnabled?: boolean;
  /** Hard-tier LLM timeout ms. Default 3000. */
  timeoutMs?: number;
}

export interface RunBotsResult {
  /** Round after all bot turns have applied. May still be in 'playing' phase
   * with a human's turn next, or 'finished' if a bot closed the round. */
  round: GameRound;
  /** Version of the round AFTER the LAST emitted bot event. Equals `startVersion`
   * when no bot events were emitted. */
  version: number;
  /** Newly-derived bot events to publish. Empty when no bot acted. */
  events: AuthorEvent[];
}

const DEFAULT_MAX_ITERATIONS = 64;

export function runBots(input: RunBotsInput): RunBotsResult {
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  let round = input.round;
  let version = input.startVersion;
  const events: AuthorEvent[] = [];

  for (let i = 0; i < maxIterations; i++) {
    // Round finished — nothing more to do here. Caller handles round_end fanout.
    if (round.phase !== 'playing') return { round, version, events };

    // Between-trick boundary: previous trick ended, no new trick started yet.
    // startTrick is bookkeeping only (no event). Both human + bot turns need
    // currentTrick to be non-null before they can act.
    if (round.currentTrick === null) {
      round = startTrick(round);
      continue;
    }

    const currentPlayer = round.currentTrick.currentPlayer;
    const member = input.room.members.find((m) => m.id === currentPlayer);
    if (!member) {
      // Defensive: orphan currentPlayer with no member record. Skipping the
      // bot loop returns control to the caller; the human SSE client will see
      // a stuck state, and ops can repair via a new round.
      return { round, version, events };
    }
    if (member.status !== 'bot') {
      // Landed on a human — stop the loop.
      return { round, version, events };
    }

    const tier: BotTier = (member.difficulty ?? 'medium') === 'hard' ? 'medium' : (member.difficulty ?? 'medium');

    const ctx = buildBotContext(round, currentPlayer, tier, input.rng);
    const decision = computeBotMove(ctx);

    // Apply + derive — one decision becomes one MoveCommand for the event
    // derivation. We re-encode the cards into CardId[] form to match the
    // wire-format that deriveMoveEvent's derivePlayEvent re-decodes.
    let command: MoveCommand;
    let newRound: GameRound;
    if (decision.kind === 'play') {
      const cardIds = encodeCards(decision.pattern.cards);
      command = { kind: 'play', fromVersion: version, cards: cardIds };
      try {
        newRound = playCards(round, decision.pattern.cards);
      } catch (err) {
        // The bot returned an illegal move — bail out cleanly. This is a bug
        // in the bot engine and we surface it via the caller's logs but don't
        // crash the move-handler request.
        console.error('[runBots] illegal play from', tier, 'bot:', (err as Error).message);
        return { round, version, events };
      }
    } else {
      command = { kind: 'pass', fromVersion: version };
      try {
        newRound = pass(round);
      } catch (err) {
        console.error('[runBots] illegal pass from', tier, 'bot:', (err as Error).message);
        return { round, version, events };
      }
    }

    const nextVersion = version + 1;
    const moveEvents = deriveMoveEvent(
      currentPlayer,
      command,
      round,
      newRound,
      nextVersion,
      input.turnDeadline
    );
    events.push(...moveEvents);

    round = newRound;
    // deriveMoveEvent emits move_played at nextVersion and (optionally)
    // trick_won at nextVersion+1. The latest version is the LAST event's
    // version, or `nextVersion` when only one event was emitted.
    version = moveEvents.length > 0 ? moveEvents[moveEvents.length - 1]!.version : nextVersion;
  }

  // Safety cap hit — return whatever we accumulated. The next /move request
  // will pick up where we left off via SSE Last-Event-ID resume.
  console.warn(
    `[runBots] hit max iteration cap (${maxIterations}); returning partial result`
  );
  return { round, version, events };
}

/**
 * Async variant — same run-loop as `runBots` but routes Hard-tier bots
 * through `computeBotMoveAsync` so the LLM client (when injected) actually
 * fires. Easy + Medium remain on the sync path; only Hard awaits.
 *
 * When `input.generate` is omitted, Hard silently falls back to Medium (same
 * behavior as sync runBots). Production callers that want Hard tier active
 * must wire a Vercel AI Gateway generate fn via this surface.
 */
export async function runBotsAsync(input: RunBotsAsyncInput): Promise<RunBotsResult> {
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  let round = input.round;
  let version = input.startVersion;
  const events: AuthorEvent[] = [];

  for (let i = 0; i < maxIterations; i++) {
    if (round.phase !== 'playing') return { round, version, events };

    if (round.currentTrick === null) {
      round = startTrick(round);
      continue;
    }

    const currentPlayer = round.currentTrick.currentPlayer;
    const member = input.room.members.find((m) => m.id === currentPlayer);
    if (!member) return { round, version, events };
    if (member.status !== 'bot') return { round, version, events };

    // True tier — no hard→medium downcast. computeBotMoveAsync handles the
    // Hard branch with the injected generate fn (or falls back to Medium if
    // not provided).
    const tier: BotTier = member.difficulty ?? 'medium';
    const asyncCtx: BotContextAsync = {
      ...buildBotContext(round, currentPlayer, tier, input.rng),
    };
    if (input.generate !== undefined) asyncCtx.generate = input.generate;
    if (input.budget !== undefined) asyncCtx.budget = input.budget;
    if (input.featureEnabled !== undefined) asyncCtx.featureEnabled = input.featureEnabled;
    if (input.timeoutMs !== undefined) asyncCtx.timeoutMs = input.timeoutMs;

    const decision = await computeBotMoveAsync(asyncCtx);

    let command: MoveCommand;
    let newRound: GameRound;
    if (decision.kind === 'play') {
      const cardIds = encodeCards(decision.pattern.cards);
      command = { kind: 'play', fromVersion: version, cards: cardIds };
      try {
        newRound = playCards(round, decision.pattern.cards);
      } catch (err) {
        console.error('[runBotsAsync] illegal play from', tier, 'bot:', (err as Error).message);
        return { round, version, events };
      }
    } else {
      command = { kind: 'pass', fromVersion: version };
      try {
        newRound = pass(round);
      } catch (err) {
        console.error('[runBotsAsync] illegal pass from', tier, 'bot:', (err as Error).message);
        return { round, version, events };
      }
    }

    const nextVersion = version + 1;
    const moveEvents = deriveMoveEvent(
      currentPlayer,
      command,
      round,
      newRound,
      nextVersion,
      input.turnDeadline
    );
    events.push(...moveEvents);

    round = newRound;
    version = moveEvents.length > 0 ? moveEvents[moveEvents.length - 1]!.version : nextVersion;
  }

  console.warn(
    `[runBotsAsync] hit max iteration cap (${maxIterations}); returning partial result`
  );
  return { round, version, events };
}

/**
 * Assemble the BotContext for the current acting bot. Looks up the partner
 * (same team) + opponents from `room.members` so the cooperation strategy
 * can read partner-hand-count.
 */
function buildBotContext(
  round: GameRound,
  me: PlayerId,
  tier: BotTier,
  rng?: () => number
): BotContext {
  const trick = round.currentTrick!;
  const mySeat = round.seats.find((s) => s.id === me);
  if (!mySeat) {
    throw new Error(`buildBotContext: seat not found for ${me}`);
  }
  const partnerSeat = round.seats.find((s) => s.team === mySeat.team && s.id !== me);
  // For 4P there's exactly one partner; for 6P/8P the cooperation primitive
  // takes the closest teammate (first match by seat order).
  const partnerId: PlayerId = partnerSeat?.id ?? me;
  const partnerHandCount = partnerSeat ? (round.hands[partnerSeat.id]?.length ?? 0) : 0;
  const opponentHandCounts = round.seats
    .filter((s) => s.team !== mySeat.team)
    .map((s) => round.hands[s.id]?.length ?? 0);

  // lastPlayer — whoever made the last play in the trick, if any. We read it
  // from the trick's bestPlayer (set on every successful play).
  const lastPlayer: PlayerId | null = trick.bestPlayer;

  const ctx: BotContext = {
    tier,
    hand: round.hands[me] ?? [],
    target: trick.bestPattern,
    levelRank: round.level,
    lastPlayer,
    me,
    partner: partnerId,
    partnerHandCount,
    opponentHandCounts,
  };
  if (rng !== undefined) {
    ctx.rng = rng;
  }
  return ctx;
}
