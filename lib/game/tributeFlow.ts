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

import { isWildcard } from './cards';
import type { Card } from './cards';
import { startTrick } from './round';
import type { GameRound, PlayerId, PendingTributeObligation } from './round';
import { applyTribute } from './tribute';
import type { TributeMode } from './tribute';

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
): GameRound {
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
      ...round,
      pendingTribute: { ...pending, obligations: updatedObligations },
    };
  }

  return finalizeManualTribute(
    round,
    pending.mode,
    updatedObligations,
    pending.finishOrder,
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
): GameRound {
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

  return finalizeManualTribute(round, 'resist', [], pending.finishOrder);
}

/**
 * Internal: apply the swap (or no-op for resist), start the first trick of
 * the new round, clear pendingTribute. Mirrors the AUTO-path tail of
 * `dealNextRound` so behavior is identical once tribute completes.
 */
function finalizeManualTribute(
  round: GameRound,
  mode: 'single' | 'double' | 'resist',
  obligations: readonly PendingTributeObligation[],
  finishOrder: readonly PlayerId[],
): GameRound {
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
    tributeMode = {
      kind: 'double',
      obligations: obligations.map((o) => ({
        from: o.from,
        to: o.to,
        tributeCard: o.selectedCard!,
      })),
    };
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
  return startTrick(withoutPending as GameRound);
}
