// Legal-play enumeration — given a hand and (optional) target pattern, return
// the set of valid Pattern plays the holder can make.
//
// SCOPE: this initial impl covers the same-rank pattern family:
//   - single, pair, triple, 4..8-card rank bomb
//   - joker bomb (2 BJ + 2 RJ)
// It does NOT yet cover sequence-type patterns (straight, threePairs,
// twoTriples, flushStraight) or fullHouse, and it does NOT enumerate
// wildcard-substituted plays for non-level ranks. These extensions are
// tracked for AI-1 part B — the Easy tier can play a legal subset of moves
// with just same-rank patterns, which is enough to drive a smoke test of the
// full game loop. Medium tier needs the sequence enumerator.
//
// Pure-functional. No state. Caller picks an entry from the returned list.

import type { Card } from '../game/cards';
import { analyzeHand, canBeat } from '../game/patterns';
import type { Pattern } from '../game/patterns';
import type { LevelRank } from '../game/levels';

export function enumerateLegalPlays(
  hand: readonly Card[],
  target: Pattern | null,
  levelRank: LevelRank
): Pattern[] {
  if (hand.length === 0) return [];

  // Group cards by rank for the same-rank family.
  const byRank = new Map<Card['rank'], Card[]>();
  for (const card of hand) {
    let bucket = byRank.get(card.rank);
    if (!bucket) {
      bucket = [];
      byRank.set(card.rank, bucket);
    }
    bucket.push(card);
  }

  const plays: Pattern[] = [];

  // For each rank bucket, generate singles → pairs → triples → bombs up to
  // count (max 8 — deck physics).
  for (const cards of byRank.values()) {
    const max = Math.min(cards.length, 8);
    for (let size = 1; size <= max; size++) {
      const subset = cards.slice(0, size);
      const pattern = analyzeHand(subset, levelRank);
      if (pattern === null) continue;
      if (target !== null && !canBeat(pattern, target, levelRank)) continue;
      plays.push(pattern);
    }
  }

  // Joker bomb: requires both jokers from both decks.
  const bj = byRank.get('BJ') ?? [];
  const rj = byRank.get('RJ') ?? [];
  if (bj.length >= 2 && rj.length >= 2) {
    const subset = [bj[0]!, bj[1]!, rj[0]!, rj[1]!];
    const pattern = analyzeHand(subset, levelRank);
    if (pattern !== null) {
      if (target === null || canBeat(pattern, target, levelRank)) {
        plays.push(pattern);
      }
    }
  }

  return plays;
}
