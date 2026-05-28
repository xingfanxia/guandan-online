// AI-strength benchmark — headless self-play harness.
//
// Plays full 4P rounds with a strategy assigned per seat, then reports which
// team's player finished first (头游). To measure A vs B fairly, runMatchup
// runs each seeded deal in BOTH team orientations (A on t1, then A on t2),
// which cancels both the deal-strength bias and the seat-0 leader advantage.

import {
  dealRound,
  startTrick,
  playCards,
  pass,
} from '@lib/game/round.js';
import type { GameRound, PlayerId, PlayerSeat } from '@lib/game/round.js';
import { buildDeck, shuffleDeck } from '@lib/game/cards.js';
import type { LevelRank } from '@lib/game/levels.js';
import seedrandom from 'seedrandom';
import type { SeatView, Strategy } from './strategies.js';

const SEATS: readonly PlayerSeat[] = [
  { id: 'p0', team: 't1', position: 0 },
  { id: 'p1', team: 't2', position: 1 },
  { id: 'p2', team: 't1', position: 2 },
  { id: 'p3', team: 't2', position: 3 },
];

// A round is bounded: every play strictly shrinks a hand and passes resolve
// tricks, so termination is guaranteed well under this cap. The cap only
// guards against an engine bug producing an infinite loop.
const MAX_STEPS = 4000;

function buildSeatView(
  round: GameRound,
  me: PlayerId,
  rng: () => number
): SeatView {
  const trick = round.currentTrick!;
  const mySeat = SEATS.find((s) => s.id === me)!;
  const partnerSeat = SEATS.find((s) => s.team === mySeat.team && s.id !== me);
  const partnerId: PlayerId = partnerSeat?.id ?? me;
  return {
    hand: round.hands[me] ?? [],
    target: trick.bestPattern,
    levelRank: round.level,
    lastPlayer: trick.bestPlayer,
    me,
    partner: partnerId,
    partnerHandCount: partnerSeat
      ? (round.hands[partnerSeat.id]?.length ?? 0)
      : 0,
    opponentHandCounts: SEATS.filter((s) => s.team !== mySeat.team).map(
      (s) => round.hands[s.id]?.length ?? 0
    ),
    rng,
  };
}

/** Play one full round to completion; returns the finished round. */
export function playRound(
  strategies: Record<PlayerId, Strategy>,
  deck: readonly import('@lib/game/cards.js').Card[],
  level: LevelRank,
  rng: () => number
): GameRound {
  let round = dealRound({
    mode: '4',
    level,
    owner: null,
    seats: SEATS,
    leader: 'p0',
    shuffledDeck: deck,
  });
  for (let step = 0; step < MAX_STEPS; step++) {
    if (round.phase !== 'playing') break;
    if (round.currentTrick === null) {
      round = startTrick(round);
      continue;
    }
    const me = round.currentTrick.currentPlayer;
    const decision = strategies[me]!(buildSeatView(round, me, rng));
    round =
      decision.kind === 'play'
        ? playCards(round, decision.pattern.cards)
        : pass(round);
  }
  return round;
}

export interface MatchupResult {
  /** Completed rounds (= seeds × 2 orientations, minus any that hit the cap). */
  games: number;
  winsA: number;
  winsB: number;
  /** Fraction of completed rounds where strategy A's team got 头游. */
  winRateA: number;
}

/**
 * Run `stratA` vs `stratB` across `seeds` deals, each played in both team
 * orientations. Win = strategy A's team holds the first finisher (头游).
 */
export function runMatchup(
  stratA: Strategy,
  stratB: Strategy,
  seeds: number,
  level: LevelRank = '2'
): MatchupResult {
  let winsA = 0;
  let winsB = 0;
  let games = 0;

  for (let s = 0; s < seeds; s++) {
    const deckRng = seedrandom(`gd-strength-deck-${s}`);
    const deck = shuffleDeck(buildDeck(), () => deckRng());

    for (const orient of [0, 1] as const) {
      // orient 0: A controls t1; orient 1: A controls t2. Same deck both
      // ways cancels deal-strength + leader bias.
      const aTeam = orient === 0 ? 't1' : 't2';
      const strategies: Record<PlayerId, Strategy> = {};
      for (const seat of SEATS) {
        strategies[seat.id] = seat.team === aTeam ? stratA : stratB;
      }
      const playRng = seedrandom(`gd-strength-play-${s}-${orient}`);
      const final = playRound(strategies, deck, level, () => playRng());

      const firstId = final.finishOrder[0];
      if (firstId === undefined) continue; // hit the cap (shouldn't happen)
      const firstSeat = SEATS.find((seat) => seat.id === firstId)!;
      if (firstSeat.team === aTeam) winsA += 1;
      else winsB += 1;
      games += 1;
    }
  }

  return { games, winsA, winsB, winRateA: games > 0 ? winsA / games : 0 };
}
