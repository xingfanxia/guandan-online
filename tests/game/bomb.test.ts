import { describe, expect, it } from 'vitest';
import {
  bombPower,
  bombRankValue,
  compareBombs,
  detectBomb,
} from '@lib/game/bomb';
import type { Bomb } from '@lib/game/bomb';
import type { Card, NaturalSuit, NaturalRank, JokerRank } from '@lib/game/cards';

const c = (
  suit: Card['suit'],
  rank: Card['rank'],
  deck: Card['deck'] = 1
): Card => ({ suit, rank, deck });

const rankBomb = (rank: NaturalRank, count: 4 | 5 | 6 | 7 | 8): Bomb => ({
  kind: 'rank',
  rank,
  length: count,
  cards: Array.from({ length: count }, (_, i) =>
    c(['spades', 'hearts', 'clubs', 'diamonds'][i % 4] as NaturalSuit, rank, ((i % 2) + 1) as 1 | 2)
  ),
});

const flushStraight = (suit: NaturalSuit, highRank: NaturalRank): Bomb => ({
  kind: 'flushStraight',
  rank: highRank,
  suit,
  cards: [],
});

const jokerBomb = (): Bomb => ({
  kind: 'jokerBomb',
  cards: [
    c('joker', 'BJ', 1),
    c('joker', 'BJ', 2),
    c('joker', 'RJ', 1),
    c('joker', 'RJ', 2),
  ],
});

// ─── bombPower: tier ordering per game-rules.md bomb hierarchy ────────────────

describe('bombPower — tier ordering', () => {
  it('4-card rank bomb is weakest (tier 1)', () => {
    expect(bombPower(rankBomb('5', 4))).toBe(1);
  });

  it('5-card rank bomb (tier 2)', () => {
    expect(bombPower(rankBomb('5', 5))).toBe(2);
  });

  it('flush straight (tier 3) — beats 5-card bomb, loses to 6-card bomb', () => {
    expect(bombPower(flushStraight('spades', '7'))).toBe(3);
    expect(bombPower(flushStraight('spades', '7'))).toBeGreaterThan(
      bombPower(rankBomb('A', 5))
    );
    expect(bombPower(flushStraight('spades', 'A'))).toBeLessThan(
      bombPower(rankBomb('2', 6))
    );
  });

  it('6-card rank bomb (tier 4)', () => {
    expect(bombPower(rankBomb('5', 6))).toBe(4);
  });

  it('7-card rank bomb (tier 5)', () => {
    expect(bombPower(rankBomb('5', 7))).toBe(5);
  });

  it('8-card rank bomb (tier 6) — largest non-joker bomb', () => {
    expect(bombPower(rankBomb('5', 8))).toBe(6);
  });

  it('joker bomb is strongest (tier 7)', () => {
    expect(bombPower(jokerBomb())).toBe(7);
    expect(bombPower(jokerBomb())).toBeGreaterThan(bombPower(rankBomb('A', 8)));
  });
});

// ─── bombRankValue: within-tier ordering ──────────────────────────────────────

describe('bombRankValue — within-tier comparison', () => {
  it('natural rank 2 = lowest (value 1)', () => {
    expect(bombRankValue(rankBomb('2', 4), '5')).toBe(1);
  });

  it('natural rank A = value 13 (when not level)', () => {
    expect(bombRankValue(rankBomb('A', 4), '5')).toBe(13);
  });

  it('level-rank bomb lifted to value 14 (above A)', () => {
    expect(bombRankValue(rankBomb('5', 4), '5')).toBe(14);
    expect(bombRankValue(rankBomb('2', 4), '2')).toBe(14);
    expect(bombRankValue(rankBomb('A', 4), 'A')).toBe(14);
  });

  it('flush straight ranks by natural high card; level does NOT lift', () => {
    // 3-4-5-6-7 flush straight when level=5 → high card is still 7 = value 6
    expect(bombRankValue(flushStraight('spades', '7'), '5')).toBe(6);
    // A-high flush straight (10-J-Q-K-A) → value 13
    expect(bombRankValue(flushStraight('spades', 'A'), '5')).toBe(13);
    // Low-end flush straight A-2-3-4-5 → high is 5 = value 4
    expect(bombRankValue(flushStraight('spades', '5'), '8')).toBe(4);
  });

  it('joker bomb has no within-tier rank (returns 0; only ties with self)', () => {
    expect(bombRankValue(jokerBomb(), '5')).toBe(0);
  });
});

// ─── compareBombs ─────────────────────────────────────────────────────────────

describe('compareBombs', () => {
  it('returns 1 when a beats b across tiers', () => {
    expect(compareBombs(rankBomb('2', 6), rankBomb('A', 5), '5')).toBe(1);
    expect(compareBombs(jokerBomb(), rankBomb('A', 8), '5')).toBe(1);
  });

  it('returns -1 when a loses to b across tiers', () => {
    expect(compareBombs(rankBomb('A', 4), flushStraight('spades', '3'), '5')).toBe(-1);
  });

  it('returns 1 when same tier but a has higher rank', () => {
    expect(compareBombs(rankBomb('A', 4), rankBomb('K', 4), '5')).toBe(1);
  });

  it('returns -1 when same tier but a has lower rank', () => {
    expect(compareBombs(rankBomb('3', 5), rankBomb('A', 5), '5')).toBe(-1);
  });

  it('returns 0 on exact tie (same kind, same rank, same length)', () => {
    expect(compareBombs(rankBomb('A', 4), rankBomb('A', 4), '5')).toBe(0);
    expect(compareBombs(jokerBomb(), jokerBomb(), '5')).toBe(0);
  });

  it('level rank wins over A within same-length bomb', () => {
    // 4-bomb of level-5 beats 4-bomb of A
    expect(compareBombs(rankBomb('5', 4), rankBomb('A', 4), '5')).toBe(1);
  });

  it('two flush straights compared by natural high card (level irrelevant)', () => {
    // 3-4-5(level)-6-7 spades vs 4-5-6-7-8 hearts → 8 > 7
    expect(
      compareBombs(flushStraight('spades', '7'), flushStraight('hearts', '8'), '5')
    ).toBe(-1);
  });
});

// ─── detectBomb: rank bombs (no wildcards) ────────────────────────────────────

describe('detectBomb — pure rank bombs', () => {
  it('detects 4-of-a-kind as 4-card rank bomb', () => {
    const cards: Card[] = [
      c('spades', '7', 1),
      c('hearts', '7', 1),
      c('clubs', '7', 1),
      c('diamonds', '7', 1),
    ];
    const bomb = detectBomb(cards, '5');
    expect(bomb?.kind).toBe('rank');
    if (bomb?.kind === 'rank') {
      expect(bomb.rank).toBe('7');
      expect(bomb.length).toBe(4);
    }
  });

  it('detects 5-of-a-kind (5-card rank bomb, requires duplicate deck card)', () => {
    const cards: Card[] = [
      c('spades', '7', 1),
      c('hearts', '7', 1),
      c('clubs', '7', 1),
      c('diamonds', '7', 1),
      c('spades', '7', 2),
    ];
    const bomb = detectBomb(cards, '5');
    expect(bomb?.kind).toBe('rank');
    if (bomb?.kind === 'rank') {
      expect(bomb.length).toBe(5);
      expect(bomb.rank).toBe('7');
    }
  });

  it('detects 6-of-a-kind', () => {
    const cards: Card[] = [
      c('spades', '7', 1), c('hearts', '7', 1), c('clubs', '7', 1),
      c('diamonds', '7', 1), c('spades', '7', 2), c('hearts', '7', 2),
    ];
    expect(detectBomb(cards, '5')).toMatchObject({ kind: 'rank', rank: '7', length: 6 });
  });

  it('detects 8-of-a-kind (max non-joker bomb)', () => {
    const cards: Card[] = (['spades', 'hearts', 'clubs', 'diamonds'] as NaturalSuit[])
      .flatMap((s) => [c(s, '7', 1), c(s, '7', 2)]);
    expect(detectBomb(cards, '5')).toMatchObject({ kind: 'rank', rank: '7', length: 8 });
  });

  it('returns null for 3 of a kind (not enough cards)', () => {
    const cards: Card[] = [c('spades', '7'), c('hearts', '7'), c('clubs', '7')];
    expect(detectBomb(cards, '5')).toBeNull();
  });

  it('returns null for 9 cards (too many for any bomb kind)', () => {
    const cards: Card[] = Array.from({ length: 9 }, (_, i) => c('spades', '7', i < 4 ? 1 : 2));
    expect(detectBomb(cards, '5')).toBeNull();
  });

  it('returns null for 4 cards of mixed ranks', () => {
    const cards: Card[] = [c('spades', '7'), c('hearts', '7'), c('clubs', '8'), c('diamonds', '7')];
    expect(detectBomb(cards, '5')).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(detectBomb([], '5')).toBeNull();
  });
});

// ─── detectBomb: joker bomb ───────────────────────────────────────────────────

describe('detectBomb — joker bomb (天王炸)', () => {
  it('detects 2BJ + 2RJ as jokerBomb', () => {
    const cards: Card[] = [
      c('joker', 'BJ' as JokerRank, 1),
      c('joker', 'BJ' as JokerRank, 2),
      c('joker', 'RJ' as JokerRank, 1),
      c('joker', 'RJ' as JokerRank, 2),
    ];
    const bomb = detectBomb(cards, '5');
    expect(bomb?.kind).toBe('jokerBomb');
  });

  it('rejects 4 BJ (impossible — only 2 in deck — but rule rejects regardless)', () => {
    const cards: Card[] = [
      c('joker', 'BJ', 1), c('joker', 'BJ', 2),
      c('joker', 'BJ', 1), c('joker', 'BJ', 2), // duplicates, but representing "all BJ"
    ];
    expect(detectBomb(cards, '5')).toBeNull();
  });

  it('rejects 3 BJ + 1 RJ', () => {
    const cards: Card[] = [
      c('joker', 'BJ', 1), c('joker', 'BJ', 2), c('joker', 'BJ', 1),
      c('joker', 'RJ', 1),
    ];
    expect(detectBomb(cards, '5')).toBeNull();
  });
});

// ─── detectBomb: flush straight (同花顺) ──────────────────────────────────────

describe('detectBomb — flush straight', () => {
  it('detects 5 consecutive same-suit cards', () => {
    const cards: Card[] = [
      c('spades', '3'), c('spades', '4'), c('spades', '5'),
      c('spades', '6'), c('spades', '7'),
    ];
    const bomb = detectBomb(cards, '8');
    expect(bomb?.kind).toBe('flushStraight');
    if (bomb?.kind === 'flushStraight') {
      expect(bomb.rank).toBe('7');
      expect(bomb.suit).toBe('spades');
    }
  });

  it('detects A-2-3-4-5 (A-low flush straight)', () => {
    const cards: Card[] = [
      c('hearts', 'A'), c('hearts', '2'), c('hearts', '3'),
      c('hearts', '4'), c('hearts', '5'),
    ];
    const bomb = detectBomb(cards, '8');
    expect(bomb?.kind).toBe('flushStraight');
    if (bomb?.kind === 'flushStraight') {
      expect(bomb.rank).toBe('5');
    }
  });

  it('detects 10-J-Q-K-A (A-high flush straight)', () => {
    const cards: Card[] = [
      c('diamonds', '10'), c('diamonds', 'J'), c('diamonds', 'Q'),
      c('diamonds', 'K'), c('diamonds', 'A'),
    ];
    const bomb = detectBomb(cards, '8');
    expect(bomb?.kind).toBe('flushStraight');
    if (bomb?.kind === 'flushStraight') {
      expect(bomb.rank).toBe('A');
    }
  });

  it('rejects 5 consecutive cards of mixed suits (regular straight, not flush)', () => {
    const cards: Card[] = [
      c('spades', '3'), c('hearts', '4'), c('spades', '5'),
      c('spades', '6'), c('spades', '7'),
    ];
    expect(detectBomb(cards, '8')).toBeNull();
  });

  it('rejects 5 same-suit but non-consecutive cards', () => {
    const cards: Card[] = [
      c('spades', '3'), c('spades', '4'), c('spades', '5'),
      c('spades', '6'), c('spades', '8'), // gap at 7
    ];
    expect(detectBomb(cards, '9')).toBeNull();
  });

  it('rejects 5-card hand containing a joker (joker cannot sit in a straight)', () => {
    const cards: Card[] = [
      c('spades', '3'), c('spades', '4'), c('spades', '5'),
      c('spades', '6'), c('joker', 'BJ'),
    ];
    expect(detectBomb(cards, '9')).toBeNull();
  });

  it('rejects 5 same-suit with duplicate ranks (deck 1 + deck 2 same suit+rank)', () => {
    const cards: Card[] = [
      c('spades', '3'), c('spades', '4'), c('spades', '5'),
      c('spades', '6', 1), c('spades', '6', 2), // duplicate 6♠
    ];
    expect(detectBomb(cards, '9')).toBeNull();
  });

  it('rejects 5-card hand with mixed suits across naturals (no flushStraight)', () => {
    // Three suits among naturals → wildcard cannot reconcile all three
    const cards: Card[] = [
      c('spades', '3'), c('spades', '4'),
      c('hearts', '5'), c('clubs', '6'), c('diamonds', '7'),
    ];
    expect(detectBomb(cards, '9')).toBeNull();
  });

  it('rejects J-Q-K-A-2 (no wrap; A is high-only OR low-only in same straight)', () => {
    const cards: Card[] = [
      c('clubs', 'J'), c('clubs', 'Q'), c('clubs', 'K'),
      c('clubs', 'A'), c('clubs', '2'),
    ];
    expect(detectBomb(cards, '5')).toBeNull();
  });
});

// ─── detectBomb: wildcard substitution ────────────────────────────────────────

describe('detectBomb — wildcard substitution', () => {
  it('3 natural 7s + 1 wildcard (level=5) → 4-bomb of 7', () => {
    const cards: Card[] = [
      c('spades', '7'), c('hearts', '7'), c('clubs', '7'),
      c('hearts', '5'), // wildcard
    ];
    const bomb = detectBomb(cards, '5');
    expect(bomb).toMatchObject({ kind: 'rank', rank: '7', length: 4 });
  });

  it('2 natural 7s + 2 wildcards (level=5) → 4-bomb of 7', () => {
    const cards: Card[] = [
      c('spades', '7'), c('clubs', '7'),
      c('hearts', '5', 1), c('hearts', '5', 2),
    ];
    expect(detectBomb(cards, '5')).toMatchObject({ kind: 'rank', rank: '7', length: 4 });
  });

  it('mixed natural ranks even with wildcards → no bomb', () => {
    // 7+7+8+wildcard → cannot all be same rank
    const cards: Card[] = [
      c('spades', '7'), c('clubs', '7'), c('hearts', '8'),
      c('hearts', '5'),
    ];
    expect(detectBomb(cards, '5')).toBeNull();
  });

  it('wildcards can complete a flush straight at any rank position', () => {
    // 3♠-4♠-(wc as 5♠)-6♠-7♠ when level=8
    const cards: Card[] = [
      c('spades', '3'), c('spades', '4'),
      c('hearts', '8'), // wildcard
      c('spades', '6'), c('spades', '7'),
    ];
    const bomb = detectBomb(cards, '8');
    expect(bomb?.kind).toBe('flushStraight');
    if (bomb?.kind === 'flushStraight') {
      expect(bomb.rank).toBe('7');
      expect(bomb.suit).toBe('spades');
    }
  });

  it('wildcard CANNOT make joker bomb (rule 4)', () => {
    // 3 BJ-RJ + 1 wildcard claiming to be a joker → still invalid
    const cards: Card[] = [
      c('joker', 'BJ', 1), c('joker', 'BJ', 2), c('joker', 'RJ', 1),
      c('hearts', '5'), // wildcard
    ];
    expect(detectBomb(cards, '5')).toBeNull();
  });

  it('bomb of level rank: 5♠+5♣+5♥+5♥ when level=5 → 4-bomb of 5 (level)', () => {
    const cards: Card[] = [
      c('spades', '5'), c('clubs', '5'),
      c('hearts', '5', 1), c('hearts', '5', 2),
    ];
    const bomb = detectBomb(cards, '5');
    expect(bomb).toMatchObject({ kind: 'rank', rank: '5', length: 4 });
  });

  it('flush straight with two wildcards filling consecutive gaps', () => {
    // 3♠-(wc)-(wc)-6♠-7♠ when level=8 → 3-4-5-6-7 ♠
    const cards: Card[] = [
      c('spades', '3'),
      c('hearts', '8', 1), c('hearts', '8', 2),
      c('spades', '6'), c('spades', '7'),
    ];
    const bomb = detectBomb(cards, '8');
    expect(bomb?.kind).toBe('flushStraight');
  });

  it('all-wildcards (2 cards) → too few cards for any bomb', () => {
    const cards: Card[] = [c('hearts', '5', 1), c('hearts', '5', 2)];
    expect(detectBomb(cards, '5')).toBeNull();
  });
});
