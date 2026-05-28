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
import type { PlayerId, PlayerSeat } from './round.js';

export type ExchangeDirection = 'cw' | 'ccw';

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
