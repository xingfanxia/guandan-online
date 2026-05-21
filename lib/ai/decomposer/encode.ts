// Card[] → Bobgy upstream string conversion.
//
// Upstream wire format (per cpp/common.cpp:235 parseCardState — walks the
// input string in 2-char chunks at offsets 0, 2, 4, ...):
//   红桃：?H | 黑桃：?S | 梅花：?C | 方块：?D | 小鬼：XB | 大鬼：XR | 数字10：0?
// Cards are **packed** with NO separator. Each card is exactly 2 chars.
// (The solver's OUTPUT solutions use spaces and pipes; that's a separate
// format handled by decode.ts.)

import type { Card, NaturalRank, NaturalSuit, Rank } from '../../game/cards.js';

const SUIT_TO_BOBGY: Record<NaturalSuit, string> = {
  spades: 'S',
  hearts: 'H',
  clubs: 'C',
  diamonds: 'D',
};

/**
 * Bobgy's single-char rank encoding. Returns '0' for rank '10' (the only
 * multi-char natural rank), full strings for jokers ('XB' / 'XR'), and
 * the rank itself for everything else.
 */
export function rankToBobgyChar(rank: Rank): string {
  if (rank === '10') return '0';
  if (rank === 'BJ') return 'XB';
  if (rank === 'RJ') return 'XR';
  return rank;
}

/** Encode a single card to Bobgy's 2-char wire form (e.g., '2S', '0H', 'XR'). */
export function encodeCard(card: Card): string {
  if (card.suit === 'joker') return rankToBobgyChar(card.rank);
  return `${rankToBobgyChar(card.rank as NaturalRank)}${SUIT_TO_BOBGY[card.suit]}`;
}

/** Encode a hand to Bobgy's packed 2-char-per-card wire form (no separator). */
export function encodeHand(hand: readonly Card[]): string {
  return hand.map(encodeCard).join('');
}
