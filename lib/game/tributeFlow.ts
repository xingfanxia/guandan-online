// Manual-tribute flow — pure transitions for the `tribute_select` and
// `anti_tribute` move commands.
//
// SYNC: docs/research/game-rules.md § "Tribute (进贡 / 还贡)" lines ~196-254.
// Companion to `lib/game/tribute.ts` (which owns mode detection + the
// final card swap). This module is the round-state side of manual mode:
//
//   AUTO PATH (current default in dealNextRound):
//     detectTributeMode4P → applyTribute → startTrick — single step.
//
//   MANUAL PATH (this file):
//     detectTributeMode4P → set pendingTribute on round → wait for
//     tribute_select / anti_tribute → applyTribute → startTrick.
//
// The dispatcher in `lib/realtime/handleMove.ts` routes the wire commands to
// `selectTributeCard` / `declareAntiTribute`. These throw on invalid input;
// the dispatcher wraps the throw into a `MoveResponse { ok: false }`.

import { isWildcard } from './cards.js';
import type { Card } from './cards.js';
import { startTrick } from './round.js';
import type { GameRound, PlayerId, PendingTributeObligation } from './round.js';
import { applyTribute } from './tribute.js';
import type { TributeExchange, TributeMode } from './tribute.js';
import { openExchangeVote } from './exchange.js';

/**
 * Result of a manual-tribute command. `exchanges` is non-null only on the
 * finalizing call (last tribute_select that satisfies all obligations, or
 * anti_tribute). Intermediate selections (still waiting on other players)
 * return `exchanges: null` so the caller knows not to emit a tribute_resolved
 * event yet.
 *
 * For resist: `exchanges` is an empty array (`[]`) — no swap, but the flow
 * did finalize (trick started, pendingTribute cleared). Callers distinguish
 * `null` (in-progress) from `[]` (resist-finalized) when deciding to emit
 * tribute_resolved.
 */
export interface TributeFlowResult {
  round: GameRound;
  exchanges: TributeExchange[] | null;
}

/**
 * Validate + record the loser's chosen tribute card. If this completes all
 * pending obligations, finalize the tribute (apply the swap, start the first
 * trick, clear `pendingTribute`). Otherwise return the round with the
 * obligation marked as selected so subsequent calls can finish the rest.
 *
 * Throws on:
 *   - no pending tribute on the round
 *   - mode is 'resist' (only `declareAntiTribute` valid here)
 *   - player has no obligation in the pending state
 *   - player has already selected
 *   - card not present in the player's hand
 *   - card is a wildcard (heart-suit level rank — exempt per rules)
 */
export function selectTributeCard(
  round: GameRound,
  playerId: PlayerId,
  card: Card,
): TributeFlowResult {
  const pending = round.pendingTribute;
  if (!pending) {
    throw new Error('selectTributeCard: no pending tribute on this round');
  }
  if (pending.mode === 'resist') {
    throw new Error(
      'selectTributeCard: resist mode does not accept tribute_select — use anti_tribute',
    );
  }

  const idx = pending.obligations.findIndex((o) => o.from === playerId);
  if (idx < 0) {
    throw new Error(
      `selectTributeCard: player ${playerId} has no tribute obligation in this round`,
    );
  }
  const obligation = pending.obligations[idx]!;
  if (obligation.selectedCard !== null) {
    throw new Error(
      `selectTributeCard: player ${playerId} has already selected a tribute card`,
    );
  }

  const hand = round.hands[playerId] ?? [];
  const inHand = hand.some(
    (c) => c.suit === card.suit && c.rank === card.rank && c.deck === card.deck,
  );
  if (!inHand) {
    throw new Error(
      `selectTributeCard: ${card.rank}-${card.suit}-${card.deck} not in ${playerId}'s hand`,
    );
  }
  if (isWildcard(card, round.level)) {
    throw new Error(
      'selectTributeCard: cannot tribute a wildcard (heart-suit level rank is exempt)',
    );
  }

  const updatedObligations: PendingTributeObligation[] = pending.obligations.map(
    (o, i) => (i === idx ? { ...o, selectedCard: card } : o),
  );

  const allSelected = updatedObligations.every((o) => o.selectedCard !== null);
  if (!allSelected) {
    return {
      round: {
        ...round,
        pendingTribute: { ...pending, obligations: updatedObligations },
      },
      exchanges: null,
    };
  }

  return finalizeManualTribute(
    round,
    pending.mode,
    updatedObligations,
    pending.finishOrder,
    pending.cardExchangeAfter ?? false,
  );
}

/**
 * Declare anti-tribute (resist) on the round. Available only when mode is
 * 'resist' (i.e., the losing team collectively holds both red jokers, already
 * verified by `detectTributeMode4P` upstream).
 *
 * Either of the two losing-team players can call this; we treat it as a team
 * decision rather than locking it to a specific seat.
 *
 * Throws on:
 *   - no pending tribute on the round
 *   - mode is not 'resist' (use `selectTributeCard` instead)
 *   - player is on the winning team (not a loser)
 */
export function declareAntiTribute(
  round: GameRound,
  playerId: PlayerId,
): TributeFlowResult {
  const pending = round.pendingTribute;
  if (!pending) {
    throw new Error('declareAntiTribute: no pending tribute on this round');
  }
  if (pending.mode !== 'resist') {
    throw new Error(
      'declareAntiTribute: anti_tribute only valid in resist mode (losers must hold both red jokers)',
    );
  }

  const winnerId = pending.finishOrder[0];
  if (winnerId === undefined) {
    throw new Error('declareAntiTribute: finishOrder is empty');
  }
  const winnerTeam = round.seats.find((s) => s.id === winnerId)?.team;
  if (winnerTeam === undefined) {
    throw new Error(`declareAntiTribute: winner ${winnerId} not seated`);
  }
  const declarerTeam = round.seats.find((s) => s.id === playerId)?.team;
  if (declarerTeam === undefined) {
    throw new Error(`declareAntiTribute: player ${playerId} not seated`);
  }
  if (declarerTeam === winnerTeam) {
    throw new Error(
      `declareAntiTribute: ${playerId} is on the winning team and cannot declare resist`,
    );
  }

  return finalizeManualTribute(
    round,
    'resist',
    [],
    pending.finishOrder,
    pending.cardExchangeAfter ?? false,
  );
}

/**
 * Internal: apply the swap (or no-op for resist), clear pendingTribute, then
 * either open the card-exchange vote (when the room rule is on — EXCHANGE-1
 * interleave) or start the first trick. Mirrors the AUTO-path tail of
 * `dealNextRound` (tribute → exchange? → trick) so behavior is identical once
 * tribute completes.
 */
function finalizeManualTribute(
  round: GameRound,
  mode: 'single' | 'double' | 'sweep' | 'resist',
  obligations: readonly PendingTributeObligation[],
  finishOrder: readonly PlayerId[],
  cardExchangeAfter: boolean,
): TributeFlowResult {
  let tributeMode: TributeMode;
  if (mode === 'resist') {
    tributeMode = { kind: 'resist' };
  } else if (mode === 'single') {
    const o = obligations[0]!;
    tributeMode = {
      kind: 'single',
      from: o.from,
      to: o.to,
      tributeCard: o.selectedCard!,
    };
  } else {
    // double | sweep — both build an obligations array. Discriminate by mode
    // so deriveTributeEvents emits the right direction string downstream.
    const builtObligations = obligations.map((o) => ({
      from: o.from,
      to: o.to,
      tributeCard: o.selectedCard!,
    }));
    tributeMode =
      mode === 'sweep'
        ? { kind: 'sweep', obligations: builtObligations }
        : { kind: 'double', obligations: builtObligations };
  }

  const applied = applyTribute(round.hands, tributeMode, finishOrder, round.level);
  const next: GameRound = {
    ...round,
    hands: applied.newHands,
    leader: applied.firstLeader,
  };
  // Strip the pendingTribute field — it's served its purpose.
  const { pendingTribute: _stripped, ...withoutPending } = next;
  void _stripped;
  const base = withoutPending as GameRound;

  // EXCHANGE-1 interleave: with both rules on, the canonical order is
  // tribute → card exchange → trick. Open the vote instead of starting the
  // trick; the exchange-flow helpers start the trick once it resolves (same
  // convergence as the auto path). winner = finishOrder[0]; if there are no
  // losers (no opposing team), openExchangeVote returns null and we fall
  // through to start the trick.
  const winnerId = finishOrder[0];
  if (cardExchangeAfter && winnerId !== undefined) {
    const opened = openExchangeVote(base, winnerId);
    if (opened !== null) {
      return { round: opened, exchanges: applied.exchanges };
    }
  }

  return {
    round: startTrick(base),
    exchanges: applied.exchanges,
  };
}
