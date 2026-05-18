// Card encoder/decoder — wire format <-> Card object.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.2 (CardId definition).
// Format: `<RANK>-<SUIT>-<DECK>` where:
//   RANK ∈ {2..10, J, Q, K, A, BJ, RJ}
//   SUIT ∈ {S, H, C, D, J}  ("J" for joker so the format stays disambiguated
//                            even when RANK is a joker rank)
//   DECK ∈ {1, 2}
//
// Examples: "5-S-1", "10-D-2", "A-H-1", "BJ-J-1", "RJ-J-2".
//
// This codec is the boundary between the realtime wire format and the
// game-state Card type. Used by buildClientPayload (game state → ServerEvent
// payloads) and by the inverse path (POST /move body → game-state cards).

import type { Card, NaturalRank, Rank, Suit } from '../game/cards';
import type { CardId } from './messages';

const SUIT_TO_LETTER: Record<Suit, string> = {
  spades: 'S',
  hearts: 'H',
  clubs: 'C',
  diamonds: 'D',
  joker: 'J',
};

const LETTER_TO_SUIT: Record<string, Suit> = {
  S: 'spades',
  H: 'hearts',
  C: 'clubs',
  D: 'diamonds',
  J: 'joker',
};

const VALID_NATURAL_RANKS: ReadonlySet<NaturalRank> = new Set([
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
]);

const VALID_JOKER_RANKS = new Set(['BJ', 'RJ']);

export function encodeCard(card: Card): CardId {
  return `${card.rank}-${SUIT_TO_LETTER[card.suit]}-${card.deck}`;
}

export function decodeCardId(id: CardId): Card {
  const parts = id.split('-');
  if (parts.length !== 3) {
    throw new Error(`decodeCardId: malformed id "${id}" — expected <rank>-<suit>-<deck>`);
  }
  const [rankStr, suitStr, deckStr] = parts as [string, string, string];

  const suit = LETTER_TO_SUIT[suitStr];
  if (!suit) {
    throw new Error(`decodeCardId: invalid suit letter "${suitStr}" in "${id}"`);
  }

  let rank: Rank;
  if (VALID_NATURAL_RANKS.has(rankStr as NaturalRank)) {
    rank = rankStr as Rank;
  } else if (VALID_JOKER_RANKS.has(rankStr)) {
    rank = rankStr as Rank;
  } else {
    throw new Error(`decodeCardId: invalid rank "${rankStr}" in "${id}"`);
  }

  const deck = Number(deckStr);
  if (deck !== 1 && deck !== 2) {
    throw new Error(`decodeCardId: invalid deck "${deckStr}" — expected 1 or 2`);
  }

  return { suit, rank, deck };
}

export function encodeCards(cards: readonly Card[]): CardId[] {
  return cards.map(encodeCard);
}

export function decodeCardIds(ids: readonly CardId[]): Card[] {
  return ids.map(decodeCardId);
}
