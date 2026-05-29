// Card exchange (换牌) — pure mechanic for the optional EXCHANGE-1 rule.
//
// SYNC: docs/plan/PLAN.md EXCHANGE-1. After tribute resolves (when the room
// rule `cardExchange` is on), the losing team votes; if the yes-fraction
// exceeds the threshold, every player gives `cardCount` cards to a neighbor in
// a server-randomized direction and receives the same count from the other
// neighbor — hand sizes are preserved. This module owns the pure operations;
// lib/game/exchangeFlow.ts owns the command-driven state transitions on
// `round.pendingExchange`.

import type { Card } from './cards.js';
import { powerRank } from './patterns.js';
import type { LevelRank } from './levels.js';
import type { GameRound, PlayerId, PlayerSeat } from './round.js';

export type ExchangeDirection = 'cw' | 'ccw';

/** Fraction of losers that must vote YES (strictly) to trigger the exchange. */
export const DEFAULT_EXCHANGE_VOTE_THRESHOLD = 0.5;
/** Cards each player swaps with a neighbor when the exchange fires. */
export const DEFAULT_EXCHANGE_CARD_COUNT = 3;

/**
 * Open the card-exchange vote on a freshly-prepared round (post-tribute, leader
 * already set). The losing team — everyone NOT on the round winner's team — are
 * the eligible voters. Returns the round with `pendingExchange` set in the
 * 'vote' phase, or `null` when there are no losers (nothing to exchange — caller
 * should start the trick instead).
 *
 * Shared by `dealNextRound` (auto/no-tribute path) and `tributeFlow.ts`
 * (manual-tribute finalize) so both open the vote identically — same threshold,
 * card count, and leader handoff. Pure; the round's existing `leader` carries
 * through to the trick once the exchange resolves.
 */
export function openExchangeVote(
  round: GameRound,
  winnerId: PlayerId
): GameRound | null {
  const winningTeam = round.seats.find((s) => s.id === winnerId)?.team;
  // Guard a degenerate input: if the winner isn't seated, `winningTeam` is
  // undefined and EVERY seat would (wrongly) count as a loser. Return null so
  // the caller falls through to starting the trick rather than opening an
  // exchange against a bogus loser set. Unreachable in practice (finishOrder[0]
  // is always seated) — this is a hard floor, not a known path.
  if (winningTeam === undefined) return null;
  const losers = round.seats
    .filter((s) => s.team !== winningTeam)
    .map((s) => s.id);
  if (losers.length === 0) return null;
  return {
    ...round,
    pendingExchange: {
      phase: 'vote',
      losers,
      votes: {},
      voteThreshold: DEFAULT_EXCHANGE_VOTE_THRESHOLD,
      cardCount: DEFAULT_EXCHANGE_CARD_COUNT,
      direction: null,
      selections: {},
      leader: round.leader,
    },
  };
}

export interface VoteTally {
  /** True once every loser has cast a vote. */
  complete: boolean;
  /** True when complete AND the yes-fraction strictly exceeds the threshold. */
  passed: boolean;
}

/**
 * Tally the losing team's exchange vote. Incomplete until every loser has
 * voted. "Passed" requires the yes-fraction to STRICTLY exceed the threshold
 * (so a 1-of-2 split at threshold 0.5 fails — a tie is not a pass). With no
 * losers there is nothing to exchange: complete + failed.
 */
export function tallyExchangeVote(
  votes: Record<PlayerId, boolean>,
  losers: readonly PlayerId[],
  threshold: number
): VoteTally {
  if (losers.length === 0) return { complete: true, passed: false };
  const cast = losers.filter((id) => id in votes);
  if (cast.length < losers.length) return { complete: false, passed: false };
  const yes = losers.filter((id) => votes[id] === true).length;
  return { complete: true, passed: yes / losers.length > threshold };
}

/** Server-randomized swap direction. rng < 0.5 → clockwise, else counter-cw. */
export function pickExchangeDirection(rng: () => number): ExchangeDirection {
  return rng() < 0.5 ? 'cw' : 'ccw';
}

/**
 * Pick the `count` lowest cards from a hand by power (level-aware). Used as the
 * timeout auto-pick when a player fails to select in time. Returns the whole
 * hand if `count` exceeds its size.
 */
export function autoSelectLowest(
  hand: readonly Card[],
  count: number,
  levelRank: LevelRank
): Card[] {
  return [...hand]
    .sort((a, b) => powerRank(a.rank, levelRank) - powerRank(b.rank, levelRank))
    .slice(0, count);
}

const cardKey = (c: Card): string => `${c.suit}-${c.rank}-${c.deck}`;

/**
 * Apply the exchange swap. Each seat gives its selected cards to the neighbor
 * in `direction` (cw → next position, ccw → previous) and receives the cards
 * the OTHER neighbor gave. Hand sizes are preserved because every player gives
 * and receives the same count. Pure — returns fresh hand arrays.
 */
export function applyExchangeSwap(
  hands: Record<PlayerId, Card[]>,
  selections: Record<PlayerId, Card[]>,
  direction: ExchangeDirection,
  seats: readonly PlayerSeat[]
): Record<PlayerId, Card[]> {
  const ordered = [...seats].sort((a, b) => a.position - b.position);
  const n = ordered.length;
  const step = direction === 'cw' ? 1 : n - 1; // +1 or -1 (mod n)

  // Strip each giver's selected cards (one occurrence per selected card).
  const out: Record<PlayerId, Card[]> = {};
  for (const seat of ordered) {
    const give = new Map<string, number>();
    for (const card of selections[seat.id] ?? []) {
      give.set(cardKey(card), (give.get(cardKey(card)) ?? 0) + 1);
    }
    out[seat.id] = (hands[seat.id] ?? []).filter((card) => {
      const k = cardKey(card);
      const remaining = give.get(k) ?? 0;
      if (remaining > 0) {
        give.set(k, remaining - 1);
        return false; // remove this card (it's being given away)
      }
      return true;
    });
  }

  // Deal each giver's selection to the seat `step` ahead.
  for (let i = 0; i < n; i++) {
    const giver = ordered[i]!;
    const receiver = ordered[(i + step) % n]!;
    const given = selections[giver.id] ?? [];
    out[receiver.id] = [...(out[receiver.id] ?? []), ...given];
  }

  return out;
}
