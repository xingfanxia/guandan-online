// Card-exchange flow — pure transitions for the `exchange_vote` and
// `exchange_select` move commands (EXCHANGE-1). Companion to exchange.ts
// (which owns the vote tally, direction RNG, and swap), mirroring the
// tribute.ts / tributeFlow.ts split.
//
// The dispatcher in lib/realtime/handleMove.ts routes the wire commands here;
// these throw on invalid input and the dispatcher wraps the throw into a
// MoveResponse { ok: false }.

import type { Card } from './cards.js';
import { startTrick } from './round.js';
import type { GameRound, PlayerId } from './round.js';
import {
  tallyExchangeVote,
  pickExchangeDirection,
  applyExchangeSwap,
  type ExchangeDirection,
} from './exchange.js';

export interface ExchangeFlowResult {
  round: GameRound;
  /**
   * - 'in-progress'   — recorded; waiting for more votes / selections.
   * - 'voting-passed' — vote passed; round is now in the select phase
   *                     (emit exchange_select_required). `direction` is set.
   * - 'skipped'       — vote failed; exchange skipped, trick started.
   * - 'applied'       — all selected; swap applied, trick started.
   */
  outcome: 'in-progress' | 'voting-passed' | 'skipped' | 'applied';
  direction?: ExchangeDirection;
}

const cardKey = (c: Card): string => `${c.suit}-${c.rank}-${c.deck}`;

/**
 * Record a loser's yes/no vote. When all losers have voted, tally: a pass
 * transitions to the select phase (direction picked via rng); a fail clears
 * pendingExchange and starts the trick.
 *
 * Throws on: no pending exchange / not vote phase / player not a loser /
 * already voted.
 */
export function castExchangeVote(
  round: GameRound,
  playerId: PlayerId,
  vote: boolean,
  rng: () => number
): ExchangeFlowResult {
  const pending = round.pendingExchange;
  if (!pending) {
    throw new Error('castExchangeVote: no pending exchange on this round');
  }
  if (pending.phase !== 'vote') {
    throw new Error(`castExchangeVote: exchange is in "${pending.phase}" phase, not "vote"`);
  }
  if (!pending.losers.includes(playerId)) {
    throw new Error(`castExchangeVote: ${playerId} is not a losing-team voter`);
  }
  if (playerId in pending.votes) {
    throw new Error(`castExchangeVote: ${playerId} has already voted`);
  }

  const votes = { ...pending.votes, [playerId]: vote };
  const tally = tallyExchangeVote(votes, pending.losers, pending.voteThreshold);

  if (!tally.complete) {
    return {
      round: { ...round, pendingExchange: { ...pending, votes } },
      outcome: 'in-progress',
    };
  }

  if (!tally.passed) {
    // Vote failed — no exchange. Strip pendingExchange + start the trick.
    return { round: finalize(round), outcome: 'skipped' };
  }

  // Vote passed — move to the select phase with a randomized direction.
  const direction = pickExchangeDirection(rng);
  return {
    round: {
      ...round,
      pendingExchange: { ...pending, votes, phase: 'select', direction },
    },
    outcome: 'voting-passed',
    direction,
  };
}

/**
 * Record a player's card selection. When ALL seated players have selected,
 * apply the swap, clear pendingExchange, and start the trick.
 *
 * Throws on: no pending exchange / not select phase / already selected /
 * wrong card count / a card not in the player's hand.
 */
export function selectExchangeCards(
  round: GameRound,
  playerId: PlayerId,
  cards: readonly Card[]
): ExchangeFlowResult {
  const pending = round.pendingExchange;
  if (!pending) {
    throw new Error('selectExchangeCards: no pending exchange on this round');
  }
  if (pending.phase !== 'select') {
    throw new Error(`selectExchangeCards: exchange is in "${pending.phase}" phase, not "select"`);
  }
  if (playerId in pending.selections) {
    throw new Error(`selectExchangeCards: ${playerId} has already selected`);
  }
  if (cards.length !== pending.cardCount) {
    throw new Error(
      `selectExchangeCards: ${playerId} must select exactly ${pending.cardCount} cards, got ${cards.length}`
    );
  }

  // Every selected card must be in the player's hand (one occurrence each).
  const handCounts = new Map<string, number>();
  for (const card of round.hands[playerId] ?? []) {
    handCounts.set(cardKey(card), (handCounts.get(cardKey(card)) ?? 0) + 1);
  }
  const need = new Map<string, number>();
  for (const card of cards) {
    need.set(cardKey(card), (need.get(cardKey(card)) ?? 0) + 1);
  }
  for (const [k, n] of need) {
    if ((handCounts.get(k) ?? 0) < n) {
      throw new Error(`selectExchangeCards: ${k} not (sufficiently) in ${playerId}'s hand`);
    }
  }

  const selections = { ...pending.selections, [playerId]: [...cards] };
  const allSelected = round.seats.every((s) => s.id in selections);

  if (!allSelected) {
    return {
      round: { ...round, pendingExchange: { ...pending, selections } },
      outcome: 'in-progress',
    };
  }

  // All selected — apply the swap. direction is guaranteed set in select phase.
  const direction = pending.direction ?? 'cw';
  const newHands = applyExchangeSwap(round.hands, selections, direction, round.seats);
  const swapped: GameRound = { ...round, hands: newHands, leader: pending.leader };
  return { round: finalize(swapped), outcome: 'applied', direction };
}

/** Strip pendingExchange and start the trick. */
function finalize(round: GameRound): GameRound {
  const { pendingExchange: _stripped, ...rest } = round;
  void _stripped;
  return startTrick(rest as GameRound);
}
