// Pattern recognition + hand comparison — the top-level engine for what a
// played card set means, and which hand beats which.
//
// SYNC: docs/research/game-rules.md § "Card types" (10-kind table, lines ~99-127)
// + § "Hand comparison (出牌比较)" (lines ~167-193) + § "Bomb hierarchy".
//
// The 10 pattern kinds:
//   non-bomb: single, pair, triple, fullHouse (3+2), threePairs (3-pair run),
//             twoTriples (2-triple run, 钢板), straight
//   bomb tier: flushStraight (同花顺), bomb (4-8 same rank), jokerBomb (天王炸)
//
// Bomb detection delegates to bomb.ts; non-bomb detection lives here. The two
// surfaces share a unified Pattern type so canBeat() can route uniformly.

import { compareBombs, detectBomb } from './bomb.js';
import type { Bomb } from './bomb.js';
import { partitionWildcards } from './wildcard.js';
import type {
  Card,
  NaturalRank,
  NaturalSuit,
  Rank,
} from './cards.js';
import type { LevelRank } from './levels.js';

// ─── Pattern type ────────────────────────────────────────────────────────────

export type PatternKind =
  | 'single'
  | 'pair'
  | 'triple'
  | 'fullHouse'
  | 'threePairs'
  | 'twoTriples'
  | 'straight'
  | 'flushStraight'
  | 'bomb'
  | 'jokerBomb';

export interface Pattern {
  kind: PatternKind;
  /** Compared rank (level-aware power, or natural high in sequences).
   *  Null only for jokerBomb (no within-tier rank). */
  rank: Rank | null;
  length: number;
  /** Set for flushStraight only — used for UI display, not comparison. */
  suit?: NaturalSuit;
  cards: readonly Card[];
}

// ─── Power rank (non-sequence comparison) ────────────────────────────────────
//
// Ordering: RJ > BJ > level > A > K > Q > J > 10 > ... > 2.
// Numeric values: 16, 15, 14, 13, 12, ..., 1.

const NATURAL_RANK_VALUE: Record<NaturalRank, number> = {
  '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7,
  '9': 8, '10': 9, J: 10, Q: 11, K: 12, A: 13,
};

export function powerRank(rank: Rank, levelRank: LevelRank): number {
  if (rank === 'RJ') return 16;
  if (rank === 'BJ') return 15;
  if (rank === levelRank) return 14;
  return NATURAL_RANK_VALUE[rank as NaturalRank];
}

// ─── Consecutive-rank windows (used by straight / threePairs / twoTriples) ───

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

// ─── analyzeHand: top-level orchestrator ──────────────────────────────────────

/**
 * Identify the strongest valid pattern interpretation for a card set.
 * Returns null if the cards form no valid Guandan pattern.
 *
 * Order of attempts:
 *   1. Bomb (if 4..8 cards) — strongest wins per game-rules.md hierarchy.
 *   2. Non-bomb by length — single/pair/triple/fullHouse/straight/threePairs/twoTriples.
 *
 * Per wildcard rule 2 ("defaults to largest hand"), substitution windows are
 * scanned high-to-low for sequence-type patterns.
 */
export function analyzeHand(
  cards: readonly Card[],
  levelRank: LevelRank
): Pattern | null {
  if (cards.length === 0) return null;

  if (cards.length >= 4 && cards.length <= 8) {
    const bomb = detectBomb(cards, levelRank);
    if (bomb) return bombToPattern(bomb);
  }

  switch (cards.length) {
    case 1:
      return trySingle(cards);
    case 2:
      return tryPair(cards, levelRank);
    case 3:
      return tryTriple(cards, levelRank);
    case 5:
      return tryFullHouse(cards, levelRank) ?? tryStraight(cards, levelRank);
    case 6:
      return tryThreePairs(cards, levelRank) ?? tryTwoTriples(cards, levelRank);
    default:
      return null;
  }
}

function bombToPattern(bomb: Bomb): Pattern {
  if (bomb.kind === 'jokerBomb') {
    return { kind: 'jokerBomb', rank: null, length: 4, cards: bomb.cards };
  }
  if (bomb.kind === 'flushStraight') {
    return {
      kind: 'flushStraight',
      rank: bomb.rank,
      length: 5,
      suit: bomb.suit,
      cards: bomb.cards,
    };
  }
  return {
    kind: 'bomb',
    rank: bomb.rank,
    length: bomb.length,
    cards: bomb.cards,
  };
}

// ─── single / pair / triple ───────────────────────────────────────────────────

function trySingle(cards: readonly Card[]): Pattern | null {
  if (cards.length !== 1) return null;
  return { kind: 'single', rank: cards[0]!.rank, length: 1, cards };
}

function tryPair(cards: readonly Card[], levelRank: LevelRank): Pattern | null {
  return tryEqualRank(cards, 'pair', 2, levelRank);
}

function tryTriple(cards: readonly Card[], levelRank: LevelRank): Pattern | null {
  return tryEqualRank(cards, 'triple', 3, levelRank);
}

function tryEqualRank(
  cards: readonly Card[],
  kind: 'pair' | 'triple',
  length: number,
  levelRank: LevelRank
): Pattern | null {
  if (cards.length !== length) return null;
  const { wildcards, naturals } = partitionWildcards(cards, levelRank);

  if (naturals.length === 0) {
    // All wildcards (impossible at length > 2, but defensive). Declare as level.
    return { kind, rank: levelRank, length, cards };
  }

  // All naturals must share one rank.
  const first = naturals[0]!.rank;
  for (const n of naturals) {
    if (n.rank !== first) return null;
  }

  // Wildcards cannot substitute jokers (rule 4) — so a joker pair MUST have
  // zero wildcards (game-rules.md note: joker pairs are valid only with 2 of
  // the same joker rank, never one of each).
  if ((first === 'BJ' || first === 'RJ') && wildcards.length > 0) {
    return null;
  }

  return { kind, rank: first, length, cards };
}

// ─── fullHouse (3+2) ──────────────────────────────────────────────────────────

function tryFullHouse(
  cards: readonly Card[],
  levelRank: LevelRank
): Pattern | null {
  if (cards.length !== 5) return null;
  const { wildcards, naturals } = partitionWildcards(cards, levelRank);

  // Jokers can't appear in fullHouse (wildcards can't substitute them, and
  // fullHouse with a joker as triple/pair is not part of the 10-kind table).
  for (const n of naturals) {
    if (n.suit === 'joker') return null;
  }

  const counts = new Map<NaturalRank, number>();
  for (const n of naturals) {
    const r = n.rank as NaturalRank;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }

  const ranks = Array.from(counts.keys());

  if (ranks.length === 1) {
    // All naturals same rank. To form (3, 2), the 2 wildcards must contribute
    // the pair (declared as the level rank). So we need exactly 3 naturals
    // of that rank + 2 wildcards.
    const onlyRank = ranks[0]!;
    if (counts.get(onlyRank) === 3 && wildcards.length === 2) {
      return { kind: 'fullHouse', rank: onlyRank, length: 5, cards };
    }
    return null;
  }

  if (ranks.length === 2) {
    const [r1, r2] = ranks as [NaturalRank, NaturalRank];
    const c1 = counts.get(r1)!;
    const c2 = counts.get(r2)!;
    // Try every wildcard split (a to r1, w-a to r2). When more than one split
    // is valid (e.g. 1×7 + 2×5 + 2 wildcards can be 7,7,7+5,5 OR 5,5,5+7,7),
    // pick the MAXIMAL triple rank per the "defaults to largest hand"
    // convention. Returning the first valid split instead made the move
    // generator and playCards disagree on wildcard full houses (finding F13).
    let best: NaturalRank | null = null;
    for (let a = 0; a <= wildcards.length; a++) {
      const b = wildcards.length - a;
      const f1 = c1 + a;
      const f2 = c2 + b;
      if (Math.max(f1, f2) === 3 && Math.min(f1, f2) === 2) {
        const tripleRank = f1 === 3 ? r1 : r2;
        if (
          best === null ||
          powerRank(tripleRank, levelRank) > powerRank(best, levelRank)
        ) {
          best = tripleRank;
        }
      }
    }
    if (best !== null) {
      return { kind: 'fullHouse', rank: best, length: 5, cards };
    }
    return null;
  }

  // 3+ distinct natural ranks → no fullHouse interpretation possible.
  return null;
}

// ─── straight (5 consecutive distinct ranks, mixed suits) ─────────────────────

function tryStraight(
  cards: readonly Card[],
  levelRank: LevelRank
): Pattern | null {
  if (cards.length !== 5) return null;
  const { wildcards, naturals } = partitionWildcards(cards, levelRank);

  for (const n of naturals) {
    if (n.suit === 'joker') return null;
  }

  const naturalRanks = naturals.map((n) => n.rank as NaturalRank);
  if (new Set(naturalRanks).size !== naturalRanks.length) return null;

  for (let i = STRAIGHT_WINDOWS.length - 1; i >= 0; i--) {
    const window = STRAIGHT_WINDOWS[i]!;
    if (!naturalRanks.every((r) => window.includes(r))) continue;
    const holes = window.filter((r) => !naturalRanks.includes(r));
    if (holes.length === wildcards.length) {
      const high = window[window.length - 1]!;
      return { kind: 'straight', rank: high, length: 5, cards };
    }
  }
  return null;
}

// ─── threePairs (三连对) — 3 consecutive pairs, 6 cards ──────────────────────

function tryThreePairs(
  cards: readonly Card[],
  levelRank: LevelRank
): Pattern | null {
  if (cards.length !== 6) return null;
  const { wildcards, naturals } = partitionWildcards(cards, levelRank);

  for (const n of naturals) {
    if (n.suit === 'joker') return null;
  }

  const counts = new Map<NaturalRank, number>();
  for (const n of naturals) {
    const r = n.rank as NaturalRank;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  // Any rank with > 2 naturals means we can't form 2-of-each.
  for (const ct of counts.values()) {
    if (ct > 2) return null;
  }

  for (let i = THREE_PAIRS_WINDOWS.length - 1; i >= 0; i--) {
    const window = THREE_PAIRS_WINDOWS[i]!;
    let allIn = true;
    for (const r of counts.keys()) {
      if (!window.includes(r)) {
        allIn = false;
        break;
      }
    }
    if (!allIn) continue;

    let needed = 0;
    for (const r of window) {
      needed += Math.max(0, 2 - (counts.get(r) ?? 0));
    }
    if (needed === wildcards.length) {
      const high = window[window.length - 1]!;
      return { kind: 'threePairs', rank: high, length: 6, cards };
    }
  }
  return null;
}

// ─── twoTriples (钢板 / 二连三) — 2 consecutive triples, 6 cards ─────────────

function tryTwoTriples(
  cards: readonly Card[],
  levelRank: LevelRank
): Pattern | null {
  if (cards.length !== 6) return null;
  const { wildcards, naturals } = partitionWildcards(cards, levelRank);

  for (const n of naturals) {
    if (n.suit === 'joker') return null;
  }

  const counts = new Map<NaturalRank, number>();
  for (const n of naturals) {
    const r = n.rank as NaturalRank;
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  for (const ct of counts.values()) {
    if (ct > 3) return null;
  }

  for (let i = TWO_TRIPLES_WINDOWS.length - 1; i >= 0; i--) {
    const window = TWO_TRIPLES_WINDOWS[i]!;
    let allIn = true;
    for (const r of counts.keys()) {
      if (!window.includes(r)) {
        allIn = false;
        break;
      }
    }
    if (!allIn) continue;

    let needed = 0;
    for (const r of window) {
      needed += Math.max(0, 3 - (counts.get(r) ?? 0));
    }
    if (needed === wildcards.length) {
      const high = window[window.length - 1]!;
      return { kind: 'twoTriples', rank: high, length: 6, cards };
    }
  }
  return null;
}

// ─── canBeat — challenger beats target? ──────────────────────────────────────

const BOMB_KINDS = new Set<PatternKind>(['bomb', 'flushStraight', 'jokerBomb']);

function isBombPattern(p: Pattern): boolean {
  return BOMB_KINDS.has(p.kind);
}

export function canBeat(
  challenger: Pattern,
  target: Pattern,
  levelRank: LevelRank
): boolean {
  const cIsBomb = isBombPattern(challenger);
  const tIsBomb = isBombPattern(target);

  if (cIsBomb && !tIsBomb) return true;
  if (!cIsBomb && tIsBomb) return false;

  if (cIsBomb && tIsBomb) {
    return compareBombPatterns(challenger, target, levelRank) === 1;
  }

  // Both non-bomb — kind + length must match for a beat to be legal.
  if (challenger.kind !== target.kind) return false;
  if (challenger.length !== target.length) return false;
  if (challenger.rank === null || target.rank === null) return false;

  // Sequence-type patterns (straight, threePairs, twoTriples) compare via
  // NATURAL position, NOT lifted powerRank. Per docs/research/game-rules.md
  // (lines 60-68): "Level-rank cards can participate in sequential hand types
  // by inserting at their natural numeric position." Mirror bomb.ts:78-82's
  // flushStraight handling. Without this, at level 5 an A-2-3-4-5 straight
  // (rank='5', powerRank=14) would beat a 6-10 straight (rank='10', powerRank=9).
  if (
    challenger.kind === 'straight' ||
    challenger.kind === 'threePairs' ||
    challenger.kind === 'twoTriples'
  ) {
    return (
      sequenceRankValue(challenger.rank) > sequenceRankValue(target.rank)
    );
  }

  return powerRank(challenger.rank, levelRank) > powerRank(target.rank, levelRank);
}

/**
 * Natural-position rank value for sequence comparisons (straight, threePairs,
 * twoTriples). Level rank is NOT lifted — it occupies its natural slot. Jokers
 * cannot appear in sequences so they're unreachable here; defensively returns 0.
 */
function sequenceRankValue(rank: Rank): number {
  if (rank === 'BJ' || rank === 'RJ') return 0;
  return NATURAL_RANK_VALUE[rank as NaturalRank];
}

function compareBombPatterns(
  a: Pattern,
  b: Pattern,
  levelRank: LevelRank
): -1 | 0 | 1 {
  return compareBombs(patternToBomb(a), patternToBomb(b), levelRank);
}

function patternToBomb(p: Pattern): Bomb {
  if (p.kind === 'jokerBomb') {
    return { kind: 'jokerBomb', cards: p.cards };
  }
  if (p.kind === 'flushStraight') {
    return {
      kind: 'flushStraight',
      rank: p.rank as NaturalRank,
      suit: p.suit!,
      cards: p.cards,
    };
  }
  // p.kind === 'bomb'
  return {
    kind: 'rank',
    rank: p.rank as NaturalRank,
    length: p.length as 4 | 5 | 6 | 7 | 8,
    cards: p.cards,
  };
}
