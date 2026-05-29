// Round-level state — the unit of work between deal and round-end. A session
// is a sequence of rounds. A round contains one or more tricks.
//
// SYNC: docs/research/game-rules.md § "Round end & level progression"
// (lines ~258-340) and § "Hand comparison (出牌比较)" (lines ~167-193)
// + § "接风 (teammate wind)" (lines ~480-490). Tribute / 还贡 / 抗贡 logic
// belongs to TRIBUTE-1 and is NOT in this module — round.ts initializes the
// state *after* tribute exchange has happened, with the caller supplying the
// first leader.
//
// Pure-functional: every state transition returns a new GameRound. Hands are
// stored as `Record<PlayerId, Card[]>` (not Map) so the round is JSON-
// serializable for Redis persistence (NET-1).

import { deal } from './cards.js';
import type { Card, Rank, Suit, DeckId } from './cards.js';
import type { LevelRank } from './levels.js';
import { positionCount } from './mode.js';
import type { GameMode, TeamKey } from './mode.js';
import { analyzeHand, canBeat } from './patterns.js';
import type { Pattern } from './patterns.js';

// ─── Identifiers ──────────────────────────────────────────────────────────────

export type PlayerId = string;

export interface PlayerSeat {
  id: PlayerId;
  team: TeamKey;
  position: number; // 0..N-1, dense and unique within seats
}

// ─── Round state ──────────────────────────────────────────────────────────────

export type RoundPhase = 'playing' | 'finished';

export interface PendingTributeObligation {
  from: PlayerId;
  to: PlayerId;
  /**
   * Null while waiting for the `from` player to call `tribute_select`.
   * Set once they pick; cleared when the round finalizes via
   * `selectTributeCard` / `declareAntiTribute`.
   */
  selectedCard: Card | null;
}

/**
 * Manual-tribute pending state — set on the new-round shell while waiting for
 * `tribute_select` / `anti_tribute` from the obligated players. AUTO-mode flow
 * (the current default in `dealNextRound`) never produces this state; it lands
 * when the room opts into manual tribute (wired by a separate phase).
 *
 * Resist mode produces a pending state with `obligations: []` — the losers
 * must explicitly call `anti_tribute` to confirm refusal.
 */
export interface PendingTributeState {
  mode: 'single' | 'double' | 'sweep' | 'resist';
  obligations: PendingTributeObligation[];
  /** Snapshot finish order; needed for `applyTribute` first-leader selection. */
  finishOrder: PlayerId[];
  /**
   * EXCHANGE-1 interleave: true when the room rule `cardExchange` is also on, so
   * the manual-tribute finalize must open a card-exchange vote (instead of
   * starting the trick) once the swap completes — mirroring the auto path's
   * tribute → exchange → trick ordering. Set by `dealNextRound` (which has the
   * session rules); read by `tributeFlow.ts` on finalization. Absent/false ⇒
   * finalize starts the trick directly.
   */
  cardExchangeAfter?: boolean;
}

/**
 * Optional card-exchange (换牌) state — set on the new-round shell after
 * tribute resolves when the room rule `cardExchange` is on. Two phases:
 *   - 'vote': losers cast yes/no; when all have voted the tally resolves. If
 *     it fails (≤ threshold yes), the exchange is skipped and the trick starts.
 *   - 'select': every player picks `cardCount` cards; when all have selected
 *     the swap applies in `direction` and the trick starts.
 * Cleared by the exchange-flow helpers (lib/game/exchangeFlow.ts) on
 * finalization. EXCHANGE-1.
 */
export interface PendingExchangeState {
  phase: 'vote' | 'select';
  /** Losing-team players eligible to vote. */
  losers: PlayerId[];
  /** Loser id → yes/no. Populated during the vote phase. */
  votes: Record<PlayerId, boolean>;
  /** Fraction of losers that must vote yes to trigger the exchange (e.g. 0.5). */
  voteThreshold: number;
  /** How many cards each player exchanges (default 3). */
  cardCount: number;
  /** Swap direction, set when the vote passes. Null during the vote phase. */
  direction: 'cw' | 'ccw' | null;
  /** Player id → chosen cards. Populated during the select phase. */
  selections: Record<PlayerId, Card[]>;
  /** Leader once the exchange completes (1st place of the finished round). */
  leader: PlayerId;
}

export interface GameRound {
  mode: GameMode;
  level: LevelRank;
  /** Round owner — whose A-test this round is. May be null on first-ever round. */
  owner: TeamKey | null;
  seats: readonly PlayerSeat[];
  /** Cards remaining in each player's hand. Mutates only via pure rebuilds. */
  hands: Record<PlayerId, Card[]>;
  /** Who leads the next trick. */
  leader: PlayerId;
  phase: RoundPhase;
  /** Players in the order they went out (played their last card). */
  finishOrder: PlayerId[];
  /** Current trick state; null between tricks (call startTrick to begin). */
  currentTrick: Trick | null;
  /**
   * Manual-tribute pending state. Optional — only set when the round opens in
   * manual tribute mode and at least one obligation is unresolved. Cleared by
   * the manual-flow helpers once all selections finalize.
   */
  pendingTribute?: PendingTributeState;
  /**
   * Card-exchange pending state (EXCHANGE-1). Optional — set after tribute
   * when `cardExchange` is on; cleared by the exchange-flow helpers once the
   * vote fails or the swap applies. While set, the trick has not started.
   */
  pendingExchange?: PendingExchangeState;
}

// ─── Trick state ──────────────────────────────────────────────────────────────

export type TrickEntry =
  | {
      kind: 'play';
      player: PlayerId;
      pattern: Pattern;
      cards: readonly Card[];
    }
  | { kind: 'pass'; player: PlayerId };

export interface Trick {
  leader: PlayerId;
  currentPlayer: PlayerId;
  bestPattern: Pattern | null;
  bestPlayer: PlayerId | null;
  entries: TrickEntry[];
  /**
   * Players who still need to respond (beat or pass) since the last play.
   * Empty list means the trick is ready to be resolved — but a separate end-
   * trick step computes nextLeader and clears currentTrick.
   */
  awaitingResponse: PlayerId[];
}

// ─── dealRound: build the initial state for a fresh round ────────────────────

export interface DealRoundInput {
  mode: GameMode;
  level: LevelRank;
  owner: TeamKey | null;
  /** Seats ordered by position (seats[i].position === i). */
  seats: readonly PlayerSeat[];
  /** The player who leads the first trick. Must be one of seats. */
  leader: PlayerId;
  /** Already-shuffled 108-card deck. Caller controls RNG for determinism. */
  shuffledDeck: readonly Card[];
}

export function dealRound(input: DealRoundInput): GameRound {
  const expectedSeats = positionCount(input.mode);
  if (input.seats.length !== expectedSeats) {
    throw new Error(
      `dealRound: mode ${input.mode} requires ${expectedSeats} seats, got ${input.seats.length}`
    );
  }

  if (!input.seats.some((s) => s.id === input.leader)) {
    throw new Error(`dealRound: leader "${input.leader}" not found in seats`);
  }

  // `deal` enforces deck size = 108.
  const handsArr = deal(input.shuffledDeck, expectedSeats);

  const hands: Record<PlayerId, Card[]> = {};
  for (let i = 0; i < input.seats.length; i++) {
    const seat = input.seats[i]!;
    hands[seat.id] = handsArr[i]!;
  }

  return {
    mode: input.mode,
    level: input.level,
    owner: input.owner,
    seats: input.seats,
    hands,
    leader: input.leader,
    phase: 'playing',
    finishOrder: [],
    currentTrick: null,
  };
}

// ─── Trick state machine ──────────────────────────────────────────────────────

const cardKey = (c: Card): string => `${c.suit}-${c.rank}-${c.deck}`;

/** Begin a new trick with the current leader as the first to play. */
export function startTrick(round: GameRound): GameRound {
  if (round.phase !== 'playing') {
    throw new Error(`startTrick: round phase is ${round.phase}`);
  }
  if (round.currentTrick !== null) {
    throw new Error('startTrick: a trick is already in progress');
  }
  return {
    ...round,
    currentTrick: {
      leader: round.leader,
      currentPlayer: round.leader,
      bestPattern: null,
      bestPlayer: null,
      entries: [],
      awaitingResponse: [],
    },
  };
}

/**
 * Current player plays the given cards. Validates: (a) trick in progress,
 * (b) cards in hand, (c) form a valid Pattern, (d) beat current best (if any).
 * Then: removes cards from hand, records going-out, updates trick state,
 * resolves trick-end + 接风 + round-end as needed.
 */
export function playCards(round: GameRound, cards: readonly Card[]): GameRound {
  if (round.phase !== 'playing') {
    throw new Error(`playCards: round phase is ${round.phase}`);
  }
  if (round.currentTrick === null) {
    throw new Error('playCards: no trick in progress (call startTrick first)');
  }
  if (cards.length === 0) {
    throw new Error('playCards: must play at least one card');
  }

  const trick = round.currentTrick;
  const actor = trick.currentPlayer;

  // (b) cards in hand
  const hand = round.hands[actor] ?? [];
  const handKeys = new Set(hand.map(cardKey));
  const playedKeys = new Set<string>();
  for (const card of cards) {
    const k = cardKey(card);
    if (!handKeys.has(k)) {
      throw new Error(`playCards: card ${k} is not in ${actor}'s hand`);
    }
    if (playedKeys.has(k)) {
      throw new Error(`playCards: duplicate card ${k} in play`);
    }
    playedKeys.add(k);
  }

  // (c) form a valid pattern
  const pattern = analyzeHand(cards, round.level);
  if (pattern === null) {
    throw new Error('playCards: cards do not form a valid Guandan pattern');
  }

  // (d) beat current best
  if (trick.bestPattern !== null) {
    if (!canBeat(pattern, trick.bestPattern, round.level)) {
      throw new Error('playCards: play does not beat the current best');
    }
  }

  // Apply: remove played cards from hand.
  const newHand = hand.filter((h) => !playedKeys.has(cardKey(h)));
  const newHands: Record<PlayerId, Card[]> = { ...round.hands, [actor]: newHand };

  // Going-out: actor's hand is now empty.
  const wentOut = newHand.length === 0;
  const finishOrderAfter = wentOut
    ? [...round.finishOrder, actor]
    : round.finishOrder;

  // Update trick. Actor is the new bestPlayer; awaitingResponse resets to all
  // currently-active players except the bestPlayer (gone-out players excluded
  // since they're now in finishOrder).
  const activeAfter = round.seats
    .map((s) => s.id)
    .filter((id) => !finishOrderAfter.includes(id));
  const newAwaiting = activeAfter.filter((id) => id !== actor);

  const trickAfterPlay: Trick = {
    ...trick,
    bestPattern: pattern,
    bestPlayer: actor,
    entries: [...trick.entries, { kind: 'play', player: actor, pattern, cards }],
    awaitingResponse: newAwaiting,
    currentPlayer: actor, // overwritten below
  };

  return advanceAfterAction(round, trickAfterPlay, newHands, finishOrderAfter, actor);
}

/** Current player passes. Invalid if they are the leader of an empty trick. */
export function pass(round: GameRound): GameRound {
  if (round.phase !== 'playing') {
    throw new Error(`pass: round phase is ${round.phase}`);
  }
  if (round.currentTrick === null) {
    throw new Error('pass: no trick in progress');
  }
  const trick = round.currentTrick;
  const actor = trick.currentPlayer;

  if (trick.bestPattern === null) {
    throw new Error(
      'pass: leader-of-empty-trick must play, cannot pass on the opening'
    );
  }

  const newAwaiting = trick.awaitingResponse.filter((id) => id !== actor);
  const trickAfterPass: Trick = {
    ...trick,
    entries: [...trick.entries, { kind: 'pass', player: actor }],
    awaitingResponse: newAwaiting,
  };

  return advanceAfterAction(round, trickAfterPass, round.hands, round.finishOrder, actor);
}

// ─── advanceAfterAction: end trick or advance currentPlayer ──────────────────

function advanceAfterAction(
  prevRound: GameRound,
  updatedTrick: Trick,
  newHands: Record<PlayerId, Card[]>,
  newFinishOrder: PlayerId[],
  actor: PlayerId
): GameRound {
  // Trick over when no one else owes a response.
  if (updatedTrick.awaitingResponse.length === 0) {
    return endTrick(prevRound, updatedTrick, newHands, newFinishOrder);
  }

  // Continue trick: advance to next active player CCW from actor.
  const actorSeat = prevRound.seats.find((s) => s.id === actor)!;
  const nextPlayer = nextActivePlayer(prevRound.seats, newFinishOrder, actorSeat.position);
  if (nextPlayer === null) {
    // Defensive: awaitingResponse non-empty but no active player found
    // implies inconsistent state. End the trick to avoid hang.
    return endTrick(prevRound, updatedTrick, newHands, newFinishOrder);
  }

  return {
    ...prevRound,
    hands: newHands,
    finishOrder: newFinishOrder,
    currentTrick: { ...updatedTrick, currentPlayer: nextPlayer },
  };
}

function endTrick(
  prevRound: GameRound,
  finalTrick: Trick,
  newHands: Record<PlayerId, Card[]>,
  newFinishOrder: PlayerId[]
): GameRound {
  const winner = finalTrick.bestPlayer;
  // bestPlayer is set whenever any play happened in the trick. If no play
  // ever happened (impossible here since leader must play first), would be null.
  if (winner === null) {
    throw new Error('endTrick: trick ended with no plays — invariant violated');
  }

  // Round end at N-1 finishes — check FIRST so we don't try to find an
  // inheritor when no active players remain. Auto-fill the last position
  // from the single remaining active player.
  let phase: RoundPhase = prevRound.phase;
  const finishOrderFinal = [...newFinishOrder];
  const N = prevRound.seats.length;
  if (finishOrderFinal.length >= N - 1) {
    const remaining = prevRound.seats
      .map((s) => s.id)
      .filter((id) => !finishOrderFinal.includes(id));
    if (remaining.length === 1) {
      finishOrderFinal.push(remaining[0]!);
    }
    phase = 'finished';
  }

  // 接风: if winner went out this trick, their teammate inherits the lead.
  // When the round is already finished, leader is cosmetic (no more tricks);
  // record the winner so callers can identify the last-trick winner.
  let nextLeader: PlayerId;
  if (phase === 'finished') {
    nextLeader = winner;
  } else {
    const winnerSeat = prevRound.seats.find((s) => s.id === winner)!;
    if (newFinishOrder.includes(winner)) {
      nextLeader = findInheritor(prevRound.seats, finishOrderFinal, winnerSeat);
    } else {
      nextLeader = winner;
    }
  }

  return {
    ...prevRound,
    hands: newHands,
    finishOrder: finishOrderFinal,
    leader: nextLeader,
    currentTrick: null,
    phase,
  };
}

/**
 * Find the next leader after a trick ends. 接风 first: prefer the next CCW
 * active teammate of the winner; fall back to next CCW active player of any
 * team if no teammate remains (happens in 4P when both teammates have gone
 * out, or in 6P/8P depending on the team configuration).
 */
function findInheritor(
  seats: readonly PlayerSeat[],
  finishOrder: readonly PlayerId[],
  fromSeat: PlayerSeat
): PlayerId {
  const N = seats.length;
  // Pass 1: teammate priority.
  for (let i = 1; i <= N; i++) {
    const seat = seats.find((s) => s.position === (fromSeat.position + i) % N);
    if (!seat) continue;
    if (finishOrder.includes(seat.id)) continue;
    if (seat.team === fromSeat.team) return seat.id;
  }
  // Pass 2: any active CCW.
  for (let i = 1; i <= N; i++) {
    const seat = seats.find((s) => s.position === (fromSeat.position + i) % N);
    if (!seat) continue;
    if (finishOrder.includes(seat.id)) continue;
    return seat.id;
  }
  throw new Error('findInheritor: no active player remaining (round should have ended)');
}

function nextActivePlayer(
  seats: readonly PlayerSeat[],
  finishOrder: readonly PlayerId[],
  fromPosition: number
): PlayerId | null {
  const N = seats.length;
  for (let i = 1; i <= N; i++) {
    const seat = seats.find((s) => s.position === (fromPosition + i) % N);
    if (!seat) continue;
    if (finishOrder.includes(seat.id)) continue;
    return seat.id;
  }
  return null;
}

// ─── selectFirstLeader: find the player holding a target card ─────────────────
//
// Used for first-hand-of-session leader determination (game-rules.md § "First-
// hand leader selection"). Caller picks the convention (flipped card, fixed
// rank like 2♥-at-level-2, etc.) and passes the target spec here.

export interface TargetCard {
  suit: Suit;
  rank: Rank;
  /** Match only this deck copy; omit to match either deck. */
  deck?: DeckId;
}

export function selectFirstLeader(
  hands: Readonly<Record<PlayerId, readonly Card[]>>,
  target: TargetCard
): PlayerId | null {
  for (const id of Object.keys(hands)) {
    const hand = hands[id]!;
    for (const card of hand) {
      if (card.suit !== target.suit) continue;
      if (card.rank !== target.rank) continue;
      if (target.deck !== undefined && card.deck !== target.deck) continue;
      return id;
    }
  }
  return null;
}
