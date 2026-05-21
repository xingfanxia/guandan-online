// Hand sort — canonical ordering for display + AI hand organization.
//
// Primary: descending by powerRank (highest power first).
//   RJ (16) > BJ (15) > level (14) > A (13) > K (12) > … > 2 (1)
// Secondary: suit (spades > hearts > clubs > diamonds; joker last).
// Tertiary: deck (1 before 2 — keeps duplicate cards adjacent).
//
// Pure-functional. Returns a new array; input is not mutated.

import type { Card, Suit } from './cards.js';
import type { LevelRank } from './levels.js';
import { powerRank } from './patterns.js';

const SUIT_ORDER: Record<Suit, number> = {
  spades: 0,
  hearts: 1,
  clubs: 2,
  diamonds: 3,
  joker: 4,
};

export function sortHand(hand: readonly Card[], levelRank: LevelRank): Card[] {
  return hand.slice().sort((a, b) => {
    const pa = powerRank(a.rank, levelRank);
    const pb = powerRank(b.rank, levelRank);
    if (pa !== pb) return pb - pa;
    const sa = SUIT_ORDER[a.suit];
    const sb = SUIT_ORDER[b.suit];
    if (sa !== sb) return sa - sb;
    return a.deck - b.deck;
  });
}
