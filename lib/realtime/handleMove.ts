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

import { pass, playCards } from '../game/round.js';
import type { GameRound, PlayerId } from '../game/round.js';
import { declareAntiTribute, selectTributeCard } from '../game/tributeFlow.js';
import type { TributeExchange, TributeMode } from '../game/tribute.js';
import { decodeCardIds } from './cardCodec.js';
import type { MoveCommand, MoveResponse } from './commands.js';

export interface HandleMoveResult {
  newRound: GameRound;
  response: MoveResponse;
  /**
   * Populated when a tribute_select or anti_tribute command FINALIZED the
   * manual flow (all obligations satisfied or resist declared). The move
   * handler uses this to emit a tribute_resolved event.
   *
   * - `undefined` — command was not a tribute command, OR it was an
   *   intermediate select waiting for more selections.
   * - `[]` — resist finalized; no swap took place, but the event should
   *   still indicate finalization (the buildClientPayload-side event omits
   *   `tribute_resolved` entirely when exchanges is empty, but the move
   *   handler still uses this to know "tribute is done, trick has started").
   * - non-empty — single or double tribute finalized with these card swaps.
   */
  tributeExchanges?: TributeExchange[];
  /**
   * Set alongside `tributeExchanges` when finalization occurred. Tells the
   * downstream event-derivation which tribute mode finalized (resist vs
   * single vs double) so it can emit the correct `tribute_resolved` payload.
   */
  tributeMode?: Extract<TributeMode, { kind: 'single' | 'double' | 'sweep' | 'resist' }>;
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
  // Capture pendingTribute.mode BEFORE the helper runs — finalization strips
  // the field, so we'd otherwise lose the information needed to emit the
  // correct tribute_resolved event variant.
  const pendingModeBefore = round.pendingTribute?.mode;
  try {
    const result = selectTributeCard(round, playerId, card);
    return success(result.round, currentVersion, result.exchanges, pendingModeBefore);
  } catch (err) {
    return failure(round, 'invalid_move', (err as Error).message);
  }
}

function handleAntiTribute(
  round: GameRound,
  playerId: PlayerId,
  currentVersion: number,
): HandleMoveResult {
  const pendingModeBefore = round.pendingTribute?.mode;
  try {
    const result = declareAntiTribute(round, playerId);
    return success(result.round, currentVersion, result.exchanges, pendingModeBefore);
  } catch (err) {
    return failure(round, 'invalid_move', (err as Error).message);
  }
}

function success(
  newRound: GameRound,
  currentVersion: number,
  tributeExchanges?: TributeExchange[] | null,
  finalizedMode?: 'single' | 'double' | 'sweep' | 'resist',
): HandleMoveResult {
  const result: HandleMoveResult = {
    newRound,
    response: {
      ok: true,
      appliedVersion: currentVersion + 1,
      result: 'applied',
    },
  };
  if (tributeExchanges !== undefined && tributeExchanges !== null && finalizedMode !== undefined) {
    result.tributeExchanges = tributeExchanges;
    // Synthesize a TributeMode shape from the captured pre-finalize mode +
    // post-finalize exchanges. The wire layer (deriveTributeEvents) only
    // looks at `kind` for the resolved event; the tributeCard field is
    // populated by applyTribute and surfaced through `exchanges`.
    if (finalizedMode === 'resist') {
      result.tributeMode = { kind: 'resist' };
    } else if (finalizedMode === 'single' && tributeExchanges.length > 0) {
      const ex = tributeExchanges[0]!;
      result.tributeMode = { kind: 'single', from: ex.from, to: ex.to, tributeCard: ex.tribute };
    } else if (finalizedMode === 'double' || finalizedMode === 'sweep') {
      const builtObligations = tributeExchanges.map((ex) => ({
        from: ex.from,
        to: ex.to,
        tributeCard: ex.tribute,
      }));
      result.tributeMode =
        finalizedMode === 'sweep'
          ? { kind: 'sweep', obligations: builtObligations }
          : { kind: 'double', obligations: builtObligations };
    }
  }
  return result;
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
