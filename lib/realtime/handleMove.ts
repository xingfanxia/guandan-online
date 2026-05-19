// Move command dispatcher — the bridge between client wire commands and the
// game state machine.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.2 (MoveCommand variants)
// + § 7.3 (idempotency / version). This function is the heart of the api/move.ts
// handler: validate, dispatch, return a MoveResponse + new round.
//
// Idempotency (NET-2): the api/move handler calls the idempotency cache
// BEFORE this function. By the time we get here, the moveId is reserved and
// the command must execute exactly once. This function just validates and
// applies — replay-handling is the cache's job.

import { pass, playCards } from '../game/round';
import type { GameRound, PlayerId } from '../game/round';
import { declareAntiTribute, selectTributeCard } from '../game/tributeFlow';
import { decodeCardIds } from './cardCodec';
import type { MoveCommand, MoveResponse } from './commands';

export interface HandleMoveResult {
  newRound: GameRound;
  response: MoveResponse;
}

export function handleMoveCommand(
  round: GameRound,
  playerId: PlayerId,
  command: MoveCommand,
  currentVersion: number
): HandleMoveResult {
  // 1. Version check (optimistic concurrency).
  if (command.fromVersion !== currentVersion) {
    return failure(round, 'stale_version', `expected version ${currentVersion}, got ${command.fromVersion}`);
  }

  // 2. Dispatch by command kind. Tribute commands route ahead of the trick-
  //    based authority check — they operate on the pre-trick pendingTribute
  //    state, where `round.currentTrick` is null by design.
  switch (command.kind) {
    case 'tribute_select':
      return handleTributeSelect(round, playerId, command.targetCard, currentVersion);

    case 'anti_tribute':
      return handleAntiTribute(round, playerId, currentVersion);

    case 'play':
    case 'pass': {
      // Trick-based commands: only the current player may act.
      if (round.currentTrick === null || round.currentTrick.currentPlayer !== playerId) {
        return failure(round, 'not_your_turn');
      }
      return command.kind === 'play'
        ? handlePlay(round, command.cards, currentVersion)
        : handlePass(round, currentVersion);
    }

    case 'report_card':
    case 'ready':
      return failure(
        round,
        'invalid_move',
        `${command.kind} not yet implemented (lands in TRIBUTE-1 / pre-round flow)`
      );

    default: {
      const _exhaustive: never = command;
      throw new Error(`handleMoveCommand: unhandled kind ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function handlePlay(
  round: GameRound,
  cardIds: readonly string[],
  currentVersion: number
): HandleMoveResult {
  let cards;
  try {
    cards = decodeCardIds(cardIds);
  } catch (err) {
    return failure(round, 'invalid_move', `card decode failed: ${(err as Error).message}`);
  }
  try {
    const newRound = playCards(round, cards);
    return success(newRound, currentVersion);
  } catch (err) {
    return failure(round, 'invalid_move', (err as Error).message);
  }
}

function handlePass(round: GameRound, currentVersion: number): HandleMoveResult {
  try {
    const newRound = pass(round);
    return success(newRound, currentVersion);
  } catch (err) {
    return failure(round, 'invalid_move', (err as Error).message);
  }
}

function handleTributeSelect(
  round: GameRound,
  playerId: PlayerId,
  cardId: string,
  currentVersion: number,
): HandleMoveResult {
  let card;
  try {
    [card] = decodeCardIds([cardId]);
    if (!card) throw new Error('empty decode result');
  } catch (err) {
    return failure(round, 'invalid_move', `card decode failed: ${(err as Error).message}`);
  }
  try {
    const newRound = selectTributeCard(round, playerId, card);
    return success(newRound, currentVersion);
  } catch (err) {
    return failure(round, 'invalid_move', (err as Error).message);
  }
}

function handleAntiTribute(
  round: GameRound,
  playerId: PlayerId,
  currentVersion: number,
): HandleMoveResult {
  try {
    const newRound = declareAntiTribute(round, playerId);
    return success(newRound, currentVersion);
  } catch (err) {
    return failure(round, 'invalid_move', (err as Error).message);
  }
}

function success(newRound: GameRound, currentVersion: number): HandleMoveResult {
  return {
    newRound,
    response: {
      ok: true,
      appliedVersion: currentVersion + 1,
      result: 'applied',
    },
  };
}

function failure(
  round: GameRound,
  error: Exclude<MoveResponse, { ok: true }>['error'],
  details?: string
): HandleMoveResult {
  const response: MoveResponse = details
    ? { ok: false, error, details }
    : { ok: false, error };
  return { newRound: round, response };
}
