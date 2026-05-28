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

import { buildDeck, shuffleDeck } from './cards.js';
import type { GameSession } from './session.js';
import { dealRound, startTrick } from './round.js';
import type {
  GameRound,
  PendingTributeObligation,
  PendingTributeState,
  PlayerId,
} from './round.js';
import {
  applyTribute,
  detectTributeMode4P,
  detectTributeModeMP,
  type TributeExchange,
  type TributeMode,
} from './tribute.js';

export interface DealNextRoundInput {
  prevRound: GameRound;
  /** Post-applyRoundResult session — teamLevels + roundOwner already updated. */
  session: GameSession;
  /** RNG for the new deck shuffle. Tests inject seedrandom for determinism. */
  rng: () => number;
}

export interface DealNextRoundResult {
  /**
   * New round.
   *
   * AUTO path: hands post-tribute, trick started (`currentTrick` non-null).
   *
   * MANUAL path: hands pre-tribute, `pendingTribute` set, `currentTrick`
   * null. Caller must wait for `tribute_select` / `anti_tribute` commands
   * before play can begin. When `tributeMode.kind === 'none'` (no tribute
   * obligation at all — same-team finish in 4P doesn't happen, but the type
   * allows it), behaves like AUTO (trick started, no pending state).
   */
  round: GameRound;
  /** Tribute outcome (4P only). `null` for 6P/8P where tribute is skipped. */
  tributeMode: TributeMode | null;
  /**
   * Card exchanges that took place.
   *
   * AUTO path: actual exchanges (empty for 'resist' / 'none' / non-4P).
   *
   * MANUAL path: always empty — the exchanges happen later when the manual
   * flow finalizes via tributeFlow.ts. The pending state on the returned
   * round carries the obligation list instead.
   */
  exchanges: TributeExchange[];
  /**
   * True when this result deferred the tribute swap to a later manual flow.
   * Caller uses this to choose which event sequence to emit (tribute_pending
   * only vs. tribute_pending + tribute_resolved + deal).
   */
  pendingManualTribute: boolean;
  /**
   * EXCHANGE-1: true when the room rule `cardExchange` is on, so the round was
   * returned with `pendingExchange` (vote phase) set instead of a started
   * trick. The caller emits `exchange_vote_required` after the deal event and
   * waits for exchange_vote / exchange_select commands. Only set on the AUTO /
   * no-tribute path (manual-tribute + exchange is not yet interleaved).
   */
  pendingCardExchange: boolean;
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
 *   1. Shuffle + deal at new level.
 *   2. Detect tribute via `detectTributeModeMP`. Three outcomes:
 *      - sweep: winning team holds positions 1..N → multi-pair tribute (3 pairs
 *        for 6P, 4 pairs for 8P).
 *      - single: mixed-team top-N finish → 末游 → 头游 fallback.
 *      - resist: losing team holds both red jokers.
 *   3. Apply tribute (auto mode) OR defer to manual flow (when room rule set).
 *   4. Start first trick. AUTO path: leader is 末游 for single/sweep, 1st place
 *      for resist. MANUAL path: trick stays null until tribute_select /
 *      anti_tribute commands finalize.
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
  } else {
    // mode === '6' || '8'
    tributeMode = detectTributeModeMP(
      mode,
      input.prevRound.finishOrder,
      seats,
      newRound.hands
    );
  }

  // Manual-tribute path: when the room opted into manual mode AND there's
  // an actual obligation to resolve (single/double/sweep/resist), defer the
  // swap to the manual flow. The round returns with hands pre-tribute,
  // pendingTribute set, and no trick started.
  //
  // 'none' falls through to the AUTO tail so the trick still starts — there's
  // nothing to defer when there's no tribute obligation.
  if (input.session.rules.manualTribute && tributeMode.kind !== 'none') {
    const obligations: PendingTributeObligation[] =
      tributeMode.kind === 'single'
        ? [{ from: tributeMode.from, to: tributeMode.to, selectedCard: null }]
        : tributeMode.kind === 'double' || tributeMode.kind === 'sweep'
          ? tributeMode.obligations.map((o) => ({
              from: o.from,
              to: o.to,
              selectedCard: null,
            }))
          : []; // 'resist' — obligations stays empty; declarer dispatches anti_tribute
    const pending: PendingTributeState = {
      mode: tributeMode.kind,
      obligations,
      finishOrder: [...input.prevRound.finishOrder],
    };
    const pendingRound: GameRound = { ...newRound, pendingTribute: pending };
    return {
      round: pendingRound,
      tributeMode,
      exchanges: [],
      pendingManualTribute: true,
      pendingCardExchange: false,
    };
  }

  if (tributeMode.kind !== 'none') {
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

  // EXCHANGE-1: when the room rule is on, defer the trick and open the
  // card-exchange vote instead. The losing team (everyone not on the winning
  // team) votes; the flow helpers start the trick once the exchange resolves.
  if (input.session.rules.cardExchange) {
    const winningTeam = seats.find((s) => s.id === firstPlace)?.team;
    const losers = seats
      .filter((s) => s.team !== winningTeam)
      .map((s) => s.id);
    if (losers.length > 0) {
      const pendingExchangeRound: GameRound = {
        ...newRound,
        pendingExchange: {
          phase: 'vote',
          losers,
          votes: {},
          voteThreshold: 0.5,
          cardCount: 3,
          direction: null,
          selections: {},
          leader: newRound.leader,
        },
      };
      return {
        round: pendingExchangeRound,
        tributeMode,
        exchanges,
        pendingManualTribute: false,
        pendingCardExchange: true,
      };
    }
  }

  // Start the first trick of the new round so currentTrick is non-null. The
  // move handler / runBots both rely on this invariant.
  const started = startTrick(newRound);
  return {
    round: started,
    tributeMode,
    exchanges,
    pendingManualTribute: false,
    pendingCardExchange: false,
  };
}
