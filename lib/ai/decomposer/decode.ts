// Bobgy solution string → DecomposerPlay[] conversion.
//
// Solution wire format (one entry per solution from the C++ solver):
//   "SA SK SQ | H2 H2 | XR XB"
// Each '|'-separated section is one play; cards within a section are
// space-separated 2-char Bobgy tokens (see encode.ts for the inverse).
//
// We map each Bobgy token back to a Card from the ORIGINAL hand. This is
// necessary because our Card type carries a deck id (1 or 2) for the
// 108-card double deck — the wire format throws that away.
//
// Wildcard caveat: when the decomposer uses a wildcard (heart-of-level)
// as a different rank/suit (e.g., a 5♥ played as part of a 6-7-8 straight
// with token '6C'), the token won't match any card in our hand and the
// lookup returns null. Caller treats null as a fallback signal.

import type { Card, NaturalSuit } from '../../game/cards.js';
import { rankToBobgyChar } from './encode.js';

export interface DecomposerPlay {
  cards: Card[];
}

const BOBGY_SUIT_TO_OURS: Record<string, NaturalSuit> = {
  S: 'spades',
  H: 'hearts',
  C: 'clubs',
  D: 'diamonds',
};

/** Match the Bobgy 2-char token against our Card representation. */
function bobgyTokenMatches(card: Card, token: string): boolean {
  // Joker tokens are 'XB' (small) and 'XR' (big).
  if (token === 'XB') return card.suit === 'joker' && card.rank === 'BJ';
  if (token === 'XR') return card.suit === 'joker' && card.rank === 'RJ';
  if (token.length !== 2) return false;
  if (card.suit === 'joker') return false;
  const suitChar = token[1]!;
  const ourSuit = BOBGY_SUIT_TO_OURS[suitChar];
  if (!ourSuit || card.suit !== ourSuit) return false;
  return rankToBobgyChar(card.rank) === token[0];
}

/**
 * Parse one solution string (e.g., "SA SK SQ | H2 H2 | XR XB") and map
 * each token back to a Card from the supplied hand. Returns null if any
 * token can't be matched (typically because of wildcard substitution).
 */
export function decodeSolution(
  solution: string,
  originalHand: readonly Card[],
): DecomposerPlay[] | null {
  // Consume cards from a mutable working copy so each token reserves a
  // distinct Card (handles duplicates correctly within a single play).
  const remaining = originalHand.slice();
  const plays: DecomposerPlay[] = [];

  const sections = solution.split('|').map((s) => s.trim()).filter((s) => s.length > 0);
  for (const section of sections) {
    const tokens = section.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) continue;
    const cards: Card[] = [];
    for (const token of tokens) {
      const idx = remaining.findIndex((c) => bobgyTokenMatches(c, token));
      if (idx === -1) return null; // wildcard substitution or unparseable token
      cards.push(remaining[idx]!);
      remaining.splice(idx, 1);
    }
    plays.push({ cards });
  }

  return plays;
}
