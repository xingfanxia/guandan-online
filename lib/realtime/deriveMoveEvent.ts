// Produce the AuthorEvent that publishEvent should emit after a successful
// move dispatch. For v0 we cover the two move-command kinds that
// handleMoveCommand actually applies: 'play' and 'pass'. trick_won /
// round_end follow when those state transitions are detected in pre vs
// post-round comparison (out of scope for API-4 part B).
//
// move_played / move_passed are pass-through events (no hidden state), so
// the resulting AuthorEvent is structurally identical to ServerEvent.

import { analyzeHand } from '../game/patterns';
import { decodeCardIds } from './cardCodec';
import type {
  MoveCommand,
  PassCommand,
  PlayCommand,
} from './commands';
import type { GameRound, PlayerId } from '../game/round';
import type { AuthorEvent } from './buildClientPayload';
import type { ISOTimestamp } from './messages';

/**
 * Derive the AuthorEvent for a single successful move. Returns null when
 * the command kind doesn't produce a per-move broadcast (tribute_select,
 * anti_tribute, report_card, ready land with TRIBUTE-1 / pre-round flow).
 */
export function deriveMoveEvent(
  playerId: PlayerId,
  command: MoveCommand,
  preRound: GameRound,
  postRound: GameRound,
  appliedVersion: number,
  turnDeadline: ISOTimestamp
): AuthorEvent | null {
  switch (command.kind) {
    case 'play':
      return derivePlayEvent(
        playerId,
        command,
        preRound,
        postRound,
        appliedVersion,
        turnDeadline
      );
    case 'pass':
      return derivePassEvent(
        playerId,
        command,
        postRound,
        appliedVersion,
        turnDeadline
      );
    case 'tribute_select':
    case 'anti_tribute':
    case 'report_card':
    case 'ready':
      // Not yet wired through handleMoveCommand; their event derivation
      // lands alongside the matching dispatcher branches.
      return null;
    default: {
      const _exhaustive: never = command;
      throw new Error(
        `deriveMoveEvent: unhandled command ${JSON.stringify(_exhaustive)}`
      );
    }
  }
}

function derivePlayEvent(
  playerId: PlayerId,
  command: PlayCommand,
  preRound: GameRound,
  postRound: GameRound,
  appliedVersion: number,
  turnDeadline: ISOTimestamp
): AuthorEvent {
  // analyzeHand needs the decoded Card[] + the round's current level.
  const cards = decodeCardIds(command.cards);
  const pattern = analyzeHand(cards, preRound.level);
  const combinationLabel = pattern ? pattern.kind : 'unknown';

  const nextTurn = computeNextTurn(postRound, playerId);

  return {
    type: 'move_played',
    version: appliedVersion,
    player: playerId,
    cards: [...command.cards],
    combinationLabel,
    nextTurn,
    turnDeadline,
  };
}

function derivePassEvent(
  playerId: PlayerId,
  _command: PassCommand,
  postRound: GameRound,
  appliedVersion: number,
  turnDeadline: ISOTimestamp
): AuthorEvent {
  const nextTurn = computeNextTurn(postRound, playerId);
  return {
    type: 'move_passed',
    version: appliedVersion,
    player: playerId,
    nextTurn,
    turnDeadline,
  };
}

/**
 * Where the turn lands after this action. When the trick is still in
 * progress, that's `currentTrick.currentPlayer`. When the trick just ended
 * (or the round did), fall back to `postRound.leader` — the next-trick
 * leader — and ultimately to the acting player if the round has finished
 * and no one needs to act anymore.
 */
function computeNextTurn(
  postRound: GameRound,
  actingPlayerId: PlayerId
): PlayerId {
  if (postRound.currentTrick !== null) {
    return postRound.currentTrick.currentPlayer;
  }
  if (postRound.phase === 'finished') {
    return actingPlayerId; // round over; field is a placeholder
  }
  return postRound.leader;
}
