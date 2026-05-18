// Next-round orchestrator — composes deal + tribute + startTrick so the move
// handler can transition from a finished round to a fresh playable round in one
// pure step.
//
// SYNC: docs/research/game-rules.md § "Tribute (进贡 / 还贡)" + § "Round end &
// level progression". Tribute is 4P-only at v1; 6P/8P sweep-tribute is deferred.
//
// Called by `lib/api/move.ts` after `applyRoundResult` when the session phase
// is still 'in_progress'. The caller provides the previous round (whose
// `finishOrder` drives tribute detection) and the post-applyRoundResult
// session (whose `teamLevels` + `roundOwner` set the new round's level + owner).

import { buildDeck, shuffleDeck } from './cards';
import type { GameSession } from './session';
import { dealRound, startTrick } from './round';
import type { GameRound, PlayerId } from './round';
import {
  applyTribute,
  detectTributeMode4P,
  type TributeExchange,
  type TributeMode,
} from './tribute';

export interface DealNextRoundInput {
  prevRound: GameRound;
  /** Post-applyRoundResult session — teamLevels + roundOwner already updated. */
  session: GameSession;
  /** RNG for the new deck shuffle. Tests inject seedrandom for determinism. */
  rng: () => number;
}

export interface DealNextRoundResult {
  /** New round with hands post-tribute and the first trick started. */
  round: GameRound;
  /** Tribute outcome (4P only). `null` for 6P/8P where tribute is skipped. */
  tributeMode: TributeMode | null;
  /** Card exchanges that took place (empty for 'resist' / 'none' / non-4P). */
  exchanges: TributeExchange[];
}

/**
 * Build the next round from a finished round + updated session.
 *
 * 4P flow:
 *   1. Shuffle + deal a new round at the winner-team's NEW level (post-upgrade).
 *      The new round's `leader` slot is provisional — overridden below.
 *   2. Detect tribute mode from prev finishOrder + new hands.
 *   3. Apply tribute (auto mode: server picks tribute + return cards).
 *   4. Override the round's hands + leader from the tribute result.
 *   5. Start the first trick.
 *
 * 6P / 8P flow:
 *   - Skip tribute. Leader is the prev round's 1st-place finisher (head-游).
 *     (Sweep-tribute multi-pair flow deferred per game-rules.md §
 *     "Sweep tribute (6P/8P)".)
 *
 * Throws when session phase is 'finished' (caller should not call this when
 * the game is over).
 */
export function dealNextRound(input: DealNextRoundInput): DealNextRoundResult {
  if (input.session.phase === 'finished') {
    throw new Error('dealNextRound: session is already finished');
  }
  if (input.prevRound.phase !== 'finished') {
    throw new Error(
      `dealNextRound: previous round phase is "${input.prevRound.phase}", expected "finished"`
    );
  }
  if (input.prevRound.finishOrder.length !== input.prevRound.seats.length) {
    throw new Error(
      `dealNextRound: prev round finishOrder length (${input.prevRound.finishOrder.length}) ≠ seats (${input.prevRound.seats.length})`
    );
  }

  const mode = input.prevRound.mode;
  const seats = input.prevRound.seats;
  // The new round's level is the level of the team that JUST WON (now updated
  // in session.teamLevels). roundOwner is the winning team — set by
  // applyRoundResult.
  const owner = input.session.roundOwner;
  const newLevel = owner !== null ? input.session.teamLevels[owner] : '2';
  const firstPlace = input.prevRound.finishOrder[0]!;

  // Initial leader is provisional — for 4P with tribute, applyTribute returns
  // the actual firstLeader (末游 for single/double, 1st place for resist).
  // For 6P/8P, leader stays as 1st place.
  const provisionalLeader: PlayerId = firstPlace;

  const shuffled = shuffleDeck(buildDeck(), input.rng);
  let newRound = dealRound({
    mode,
    level: newLevel,
    owner,
    seats,
    leader: provisionalLeader,
    shuffledDeck: shuffled,
  });

  let tributeMode: TributeMode | null = null;
  let exchanges: TributeExchange[] = [];

  if (mode === '4') {
    tributeMode = detectTributeMode4P(
      input.prevRound.finishOrder,
      seats,
      newRound.hands
    );
    const applied = applyTribute(
      newRound.hands,
      tributeMode,
      input.prevRound.finishOrder,
      newLevel
    );
    exchanges = applied.exchanges;
    newRound = {
      ...newRound,
      hands: applied.newHands,
      leader: applied.firstLeader,
    };
  }

  // Start the first trick of the new round so currentTrick is non-null. The
  // move handler / runBots both rely on this invariant.
  const started = startTrick(newRound);
  return { round: started, tributeMode, exchanges };
}
