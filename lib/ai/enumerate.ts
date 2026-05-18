// Legal-play enumeration — given a hand and (optional) target pattern, return
// the set of valid Pattern plays the holder can make.
//
// SCOPE:
//   - same-rank family: single, pair, triple, 4..8-card rank bomb, joker bomb
//   - sequence family: straight (5), threePairs (3 consecutive pairs),
//     twoTriples (2 consecutive triples). Wildcards can fill gaps.
//   - flushStraight (5 consecutive same-suit). Wildcards become any suit.
//
// Still out of scope:
//   - fullHouse (3+2) — needs cross-rank pairing
//   - exhaustive wildcard substitution for same-rank plays at non-level ranks
//     (e.g., "pair of 7s using one wildcard as 7"). Current same-rank loop
//     only iterates natural-rank buckets, so wildcards only contribute to
//     pairs/triples/bombs of LEVEL rank (since wildcards ARE level rank).
//
// Pure-functional. No state. Caller picks an entry from the returned list.

import type { Card, NaturalRank, NaturalSuit } from '../game/cards';
import { analyzeHand, canBeat } from '../game/patterns';
import type { Pattern } from '../game/patterns';
import { partitionWildcards } from '../game/wildcard';
import type { LevelRank } from '../game/levels';

// Mirror windows from patterns.ts (kept separate to avoid coupling on private
// module internals).
const STRAIGHT_WINDOWS: readonly (readonly NaturalRank[])[] = [
  ['A', '2', '3', '4', '5'],
  ['2', '3', '4', '5', '6'],
  ['3', '4', '5', '6', '7'],
  ['4', '5', '6', '7', '8'],
  ['5', '6', '7', '8', '9'],
  ['6', '7', '8', '9', '10'],
  ['7', '8', '9', '10', 'J'],
  ['8', '9', '10', 'J', 'Q'],
  ['9', '10', 'J', 'Q', 'K'],
  ['10', 'J', 'Q', 'K', 'A'],
];

const THREE_PAIRS_WINDOWS: readonly (readonly NaturalRank[])[] = [
  ['A', '2', '3'],
  ['2', '3', '4'],
  ['3', '4', '5'],
  ['4', '5', '6'],
  ['5', '6', '7'],
  ['6', '7', '8'],
  ['7', '8', '9'],
  ['8', '9', '10'],
  ['9', '10', 'J'],
  ['10', 'J', 'Q'],
  ['J', 'Q', 'K'],
  ['Q', 'K', 'A'],
];

const TWO_TRIPLES_WINDOWS: readonly (readonly NaturalRank[])[] = [
  ['A', '2'],
  ['2', '3'],
  ['3', '4'],
  ['4', '5'],
  ['5', '6'],
  ['6', '7'],
  ['7', '8'],
  ['8', '9'],
  ['9', '10'],
  ['10', 'J'],
  ['J', 'Q'],
  ['Q', 'K'],
  ['K', 'A'],
];

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
  const addIfLegal = (pattern: Pattern | null): void => {
    if (pattern === null) return;
    if (target !== null && !canBeat(pattern, target, levelRank)) return;
    plays.push(pattern);
  };

  // ─── Same-rank family ─────────────────────────────────────────────────────
  for (const cards of byRank.values()) {
    const max = Math.min(cards.length, 8);
    for (let size = 1; size <= max; size++) {
      addIfLegal(analyzeHand(cards.slice(0, size), levelRank));
    }
  }

  // Joker bomb
  const bj = byRank.get('BJ') ?? [];
  const rj = byRank.get('RJ') ?? [];
  if (bj.length >= 2 && rj.length >= 2) {
    addIfLegal(analyzeHand([bj[0]!, bj[1]!, rj[0]!, rj[1]!], levelRank));
  }

  // ─── Sequence family ──────────────────────────────────────────────────────
  // Use natural-only buckets for windows (no jokers in sequences). Wildcards
  // come from partitionWildcards (heart-level-rank cards).
  const { wildcards, naturals } = partitionWildcards(hand, levelRank);
  const naturalsByRank = new Map<NaturalRank, Card[]>();
  for (const n of naturals) {
    if (n.suit === 'joker') continue;
    const r = n.rank as NaturalRank;
    let bucket = naturalsByRank.get(r);
    if (!bucket) {
      bucket = [];
      naturalsByRank.set(r, bucket);
    }
    bucket.push(n);
  }

  // Straights
  if (hand.length >= 5) {
    for (const window of STRAIGHT_WINDOWS) {
      addIfLegal(tryWindow(window, naturalsByRank, wildcards, 1, levelRank));
    }
  }

  // threePairs (need 2 per rank)
  if (hand.length >= 6) {
    for (const window of THREE_PAIRS_WINDOWS) {
      addIfLegal(tryWindow(window, naturalsByRank, wildcards, 2, levelRank));
    }
  }

  // twoTriples (need 3 per rank)
  if (hand.length >= 6) {
    for (const window of TWO_TRIPLES_WINDOWS) {
      addIfLegal(tryWindow(window, naturalsByRank, wildcards, 3, levelRank));
    }
  }

  // flushStraight: 5 consecutive ranks all of one suit (wildcards become any suit).
  if (hand.length >= 5) {
    const suits: NaturalSuit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
    for (const suit of suits) {
      const suitBuckets = buildSuitRankBuckets(naturals, suit);
      for (const window of STRAIGHT_WINDOWS) {
        addIfLegal(tryFlushWindow(window, suitBuckets, wildcards, levelRank));
      }
    }
  }

  return plays;
}

function buildSuitRankBuckets(
  naturals: readonly Card[],
  suit: NaturalSuit
): Map<NaturalRank, Card> {
  const out = new Map<NaturalRank, Card>();
  for (const c of naturals) {
    if (c.suit !== suit) continue;
    const r = c.rank as NaturalRank;
    if (!out.has(r)) out.set(r, c);
  }
  return out;
}

function tryFlushWindow(
  window: readonly NaturalRank[],
  suitBuckets: Map<NaturalRank, Card>,
  wildcards: readonly Card[],
  levelRank: LevelRank
): Pattern | null {
  const subset: Card[] = [];
  let wcIdx = 0;
  for (const rank of window) {
    const card = suitBuckets.get(rank);
    if (card) {
      subset.push(card);
    } else {
      if (wcIdx >= wildcards.length) return null;
      subset.push(wildcards[wcIdx]!);
      wcIdx++;
    }
  }
  const pattern = analyzeHand(subset, levelRank);
  // analyzeHand may resolve same-suit-consecutive as flushStraight; if it
  // returned a different kind (e.g., the suit-bucket happened to be all the
  // same rank, impossible here since window has distinct ranks), discard.
  return pattern?.kind === 'flushStraight' ? pattern : null;
}

/**
 * Attempt to build a pattern from a rank window where each rank needs
 * `perRank` cards. Pulls from naturals first; fills shortfall from wildcards.
 * Returns the Pattern from analyzeHand or null if not enough cards.
 */
function tryWindow(
  window: readonly NaturalRank[],
  naturalsByRank: Map<NaturalRank, Card[]>,
  wildcards: readonly Card[],
  perRank: number,
  levelRank: LevelRank
): Pattern | null {
  const subset: Card[] = [];
  let wcIdx = 0;
  for (const rank of window) {
    const bucket = naturalsByRank.get(rank) ?? [];
    const taken = Math.min(bucket.length, perRank);
    for (let i = 0; i < taken; i++) subset.push(bucket[i]!);
    const shortfall = perRank - taken;
    for (let i = 0; i < shortfall; i++) {
      if (wcIdx >= wildcards.length) return null;
      subset.push(wildcards[wcIdx]!);
      wcIdx++;
    }
  }
  return analyzeHand(subset, levelRank);
}
