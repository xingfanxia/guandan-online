// Produce the AuthorEvents that publishEvent should emit after a successful
// move dispatch. For v0 we cover:
//
//   move_played / move_passed  — every successful move
//   trick_won                  — when the move ended the current trick
//                                (preRound.currentTrick → postRound.currentTrick=null)
//
// round_end requires GameSession persistence (team levels + finished-rounds
// counter live there, NOT on GameRound) and lands with the session layer.
// All three move-command kinds also need stamping when tribute / pre-round
// flow is wired (TRIBUTE-1 / handleMove dispatch extension).
//
// move_played / move_passed / trick_won are pass-through events, so the
// AuthorEvent shape is structurally identical to ServerEvent.

import { analyzeHand } from '../game/patterns.js';
import { decodeCardIds } from './cardCodec.js';
import type {
  MoveCommand,
  PassCommand,
  PlayCommand,
} from './commands.js';
import type { GameRound, PlayerId } from '../game/round.js';
import type { AuthorEvent } from './buildClientPayload.js';
import type { ISOTimestamp } from './messages.js';

/**
 * Derive the AuthorEvents for a single successful move. Returns an array so
 * the caller can publish each in order; many moves emit just one event,
 * but a move that closes a trick emits move_played/move_passed THEN
 * trick_won at appliedVersion + 1.
 *
 * Returns [] for command kinds that don't yet have a dispatched event path
 * (tribute_select, anti_tribute, report_card, ready — these land with
 * TRIBUTE-1 / pre-round flow).
 */
export function deriveMoveEvent(
  playerId: PlayerId,
  command: MoveCommand,
  preRound: GameRound,
  postRound: GameRound,
  appliedVersion: number,
  turnDeadline: ISOTimestamp
): AuthorEvent[] {
  const moveEvent = deriveMoveOnlyEvent(
    playerId,
    command,
    preRound,
    postRound,
    appliedVersion,
    turnDeadline
  );
  if (!moveEvent) return [];

  const events: AuthorEvent[] = [moveEvent];

  // Trick-end detection: a trick was in progress (preRound.currentTrick !==
  // null — guaranteed because handleMoveCommand only applies on non-null
  // currentTrick); post is null iff this action ended it.
  if (preRound.currentTrick !== null && postRound.currentTrick === null) {
    const trickWinner = preRound.currentTrick.bestPlayer ?? playerId;
    events.push({
      type: 'trick_won',
      version: appliedVersion + 1,
      winner: trickWinner,
      nextLeader: postRound.leader,
    });
  }

  return events;
}

function deriveMoveOnlyEvent(
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
