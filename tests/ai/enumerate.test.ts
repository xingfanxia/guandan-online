import { describe, expect, it } from 'vitest';
import { enumerateLegalPlays } from '@lib/ai/enumerate';
import type { Card } from '@lib/game/cards';
import type { Pattern } from '@lib/game/patterns';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

// ─── Leading (target=null): produce any valid pattern ────────────────────────

describe('enumerateLegalPlays — leading (no target)', () => {
  it('empty hand → no plays', () => {
    expect(enumerateLegalPlays([], null, '2')).toEqual([]);
  });

  it('single card → exactly one single play', () => {
    const plays = enumerateLegalPlays([c('spades', '7')], null, '2');
    expect(plays).toHaveLength(1);
    expect(plays[0]?.kind).toBe('single');
    expect(plays[0]?.rank).toBe('7');
  });

  it('4 cards of same rank → 4 plays: single, pair, triple, 4-bomb', () => {
    const hand: Card[] = [
      c('spades', '7'), c('hearts', '7'),
      c('clubs', '7'), c('diamonds', '7'),
    ];
    const plays = enumerateLegalPlays(hand, null, '2');
    const kinds = plays.map((p) => p.kind).sort();
    expect(kinds).toContain('single');
    expect(kinds).toContain('pair');
    expect(kinds).toContain('triple');
    expect(kinds).toContain('bomb');
  });

  it('multi-rank hand → plays for each rank', () => {
    // Two 5s + one K
    const hand: Card[] = [c('spades', '5'), c('hearts', '5'), c('spades', 'K')];
    const plays = enumerateLegalPlays(hand, null, '2');
    // 1 single of K + 1 single of 5 + 1 pair of 5 = 3 plays
    const singles = plays.filter((p) => p.kind === 'single');
    const pairs = plays.filter((p) => p.kind === 'pair');
    expect(singles).toHaveLength(2); // K and 5 singles
    expect(pairs).toHaveLength(1); // pair of 5s
  });
});

// ─── Following (target is set): only beating plays ───────────────────────────

describe('enumerateLegalPlays — following a target', () => {
  it('against a single Q: only higher singles + bombs', () => {
    const target: Pattern = {
      kind: 'single',
      rank: 'Q',
      length: 1,
      cards: [c('clubs', 'Q')],
    };
    const hand: Card[] = [
      c('spades', '5'), // lower single — invalid
      c('hearts', 'K'), // higher single — valid
      c('spades', 'A'), // higher single — valid
      c('hearts', '7'), c('clubs', '7'),
      c('diamonds', '7'), c('spades', '7'), // 4-bomb — valid (beats non-bomb)
    ];
    const plays = enumerateLegalPlays(hand, target, '2');
    const kinds = plays.map((p) => `${p.kind}:${p.rank}`).sort();
    // higher singles K and A; 4-bomb of 7; potentially single/pair/triple of 7
    // (single 7 < Q so doesn't qualify; pair/triple of 7 are pair/triple, not single).
    // A pair/triple of 7 doesn't beat a SINGLE Q (different kind), so they're not valid.
    expect(kinds).toContain('single:K');
    expect(kinds).toContain('single:A');
    expect(kinds).toContain('bomb:7');
    expect(kinds).not.toContain('single:5'); // lower
    expect(kinds).not.toContain('pair:7'); // different kind
  });

  it('against a pair of 9: higher pairs + any bomb', () => {
    const target: Pattern = {
      kind: 'pair',
      rank: '9',
      length: 2,
      cards: [c('clubs', '9'), c('diamonds', '9')],
    };
    const hand: Card[] = [
      c('hearts', '7'), c('clubs', '7'), // lower pair — invalid
      c('hearts', 'K'), c('spades', 'K'), // higher pair — valid
      c('hearts', 'A'),                    // single — invalid (wrong kind)
    ];
    const plays = enumerateLegalPlays(hand, target, '2');
    const kinds = plays.map((p) => `${p.kind}:${p.rank}`).sort();
    expect(kinds).toContain('pair:K');
    expect(kinds).not.toContain('pair:7');
    expect(kinds).not.toContain('single:A');
  });

  it('against a 4-bomb of 5: only higher 4-bombs, 5+ bombs, or joker bomb', () => {
    const target: Pattern = {
      kind: 'bomb',
      rank: '5',
      length: 4,
      cards: [],
    };
    const hand: Card[] = [
      c('spades', '7'), c('hearts', '7'), c('clubs', '7'), c('diamonds', '7'),
      c('hearts', 'K'),
    ];
    const plays = enumerateLegalPlays(hand, target, '2');
    // 4-bomb of 7 > 4-bomb of 5 → valid
    expect(plays.some((p) => p.kind === 'bomb' && p.rank === '7')).toBe(true);
    // Single K is not a bomb — can't beat a bomb
    expect(plays.some((p) => p.kind === 'single')).toBe(false);
  });
});

// ─── Joker bomb ──────────────────────────────────────────────────────────────

describe('enumerateLegalPlays — joker bomb', () => {
  it('hand with 2 BJ + 2 RJ → jokerBomb play available', () => {
    const hand: Card[] = [
      c('joker', 'BJ', 1), c('joker', 'BJ', 2),
      c('joker', 'RJ', 1), c('joker', 'RJ', 2),
      c('spades', '5'),
    ];
    const plays = enumerateLegalPlays(hand, null, '2');
    expect(plays.some((p) => p.kind === 'jokerBomb')).toBe(true);
  });

  it('hand with only 1 BJ + 2 RJ → no jokerBomb', () => {
    const hand: Card[] = [
      c('joker', 'BJ', 1),
      c('joker', 'RJ', 1), c('joker', 'RJ', 2),
    ];
    const plays = enumerateLegalPlays(hand, null, '2');
    expect(plays.some((p) => p.kind === 'jokerBomb')).toBe(false);
  });

  it('joker bomb beats any bomb target', () => {
    const target: Pattern = { kind: 'bomb', rank: 'A', length: 8, cards: [] };
    const hand: Card[] = [
      c('joker', 'BJ', 1), c('joker', 'BJ', 2),
      c('joker', 'RJ', 1), c('joker', 'RJ', 2),
    ];
    const plays = enumerateLegalPlays(hand, target, '2');
    expect(plays.some((p) => p.kind === 'jokerBomb')).toBe(true);
  });
});

// ─── Level rank dynamics ─────────────────────────────────────────────────────

describe('enumerateLegalPlays — level rank effects', () => {
  it('pair of level rank (5) beats pair of A when level is 5', () => {
    const target: Pattern = { kind: 'pair', rank: 'A', length: 2, cards: [] };
    const hand: Card[] = [c('spades', '5'), c('clubs', '5')];
    const plays = enumerateLegalPlays(hand, target, '5');
    expect(plays.some((p) => p.kind === 'pair' && p.rank === '5')).toBe(true);
  });

  it('pair of 5 does NOT beat pair of A when level is 7 (5 is below A)', () => {
    const target: Pattern = { kind: 'pair', rank: 'A', length: 2, cards: [] };
    const hand: Card[] = [c('spades', '5'), c('clubs', '5')];
    const plays = enumerateLegalPlays(hand, target, '7');
    expect(plays.some((p) => p.kind === 'pair')).toBe(false);
  });
});

// ─── G-C4: wildcards substituting in same-rank family ────────────────────────
//
// Per docs/research/game-rules.md lines 70-92 (wildcard rules 1, 6): a wildcard
// (heart-of-level-rank) substitutes any non-joker card. Previously the byRank
// loop in enumerate.ts isolated wildcards from natural same-rank plays, so
// bots could never play pair K / triple K / K-bomb using a wildcard.

describe('enumerateLegalPlays — G-C4: wildcard substitution in same-rank family', () => {
  it('hand [K♠, K♦, 2♥] at level 2 produces pair K (wildcard substitutes)', () => {
    // 2♥ is the wildcard at level 2. With two natural Ks + one wildcard,
    // bot should be able to declare pair K AND triple K.
    const hand: Card[] = [c('spades', 'K'), c('diamonds', 'K'), c('hearts', '2')];
    const plays = enumerateLegalPlays(hand, null, '2');
    const kKinds = plays.filter((p) => p.rank === 'K');
    expect(kKinds.some((p) => p.kind === 'pair')).toBe(true);
    expect(kKinds.some((p) => p.kind === 'triple')).toBe(true);
  });

  it('hand [K♠, K♦, K♣, 2♥] at level 2 produces triple K AND 4-bomb K', () => {
    // 3 naturals + 1 wildcard. Should enumerate plays of K from size 1..4.
    const hand: Card[] = [
      c('spades', 'K'), c('diamonds', 'K'), c('clubs', 'K'),
      c('hearts', '2'),
    ];
    const plays = enumerateLegalPlays(hand, null, '2');
    const kKinds = plays.filter((p) => p.rank === 'K');
    expect(kKinds.some((p) => p.kind === 'triple')).toBe(true);
    expect(kKinds.some((p) => p.kind === 'bomb' && p.length === 4)).toBe(true);
  });

  it('hand [K♠, 2♥, 2♥] at level 2 produces triple K (2 wildcards + 1 natural)', () => {
    // 1 natural K + 2 wildcards → triple K. This is the "max wildcards"
    // case for triple — both wildcards substitute for K.
    const hand: Card[] = [
      c('spades', 'K'),
      c('hearts', '2', 1), c('hearts', '2', 2),
    ];
    const plays = enumerateLegalPlays(hand, null, '2');
    const kTriples = plays.filter((p) => p.kind === 'triple' && p.rank === 'K');
    expect(kTriples.length).toBeGreaterThan(0);
  });

  it('hand [2♥] alone at level 2 does NOT produce pair K (need ≥1 natural per rule 6)', () => {
    // Only a wildcard — can't conjure a pair-K out of thin air. Wildcards
    // must substitute IN a same-rank set, not stand alone for an arbitrary rank.
    // Only legal play is single (which the wildcard provides as the level rank).
    const hand: Card[] = [c('hearts', '2')];
    const plays = enumerateLegalPlays(hand, null, '2');
    // No pair / triple / bomb of K — only single (the wildcard played as itself).
    expect(plays.some((p) => p.rank === 'K')).toBe(false);
  });

  it('wildcard substitution honors target beat rules (pair K beats pair Q with wildcard)', () => {
    const target: Pattern = {
      kind: 'pair', rank: 'Q', length: 2,
      cards: [c('spades', 'Q'), c('hearts', 'Q')],
    };
    const hand: Card[] = [c('spades', 'K'), c('hearts', '2')];
    const plays = enumerateLegalPlays(hand, target, '2');
    expect(plays.some((p) => p.kind === 'pair' && p.rank === 'K')).toBe(true);
  });

  it('wildcard substitution NOT triggered for joker ranks (rule 4)', () => {
    // Can't form pair-BJ using a wildcard substitution; rule 4 forbids it.
    // Hand has 1 BJ + 1 wildcard.
    const hand: Card[] = [c('joker', 'BJ', 1), c('hearts', '2')];
    const plays = enumerateLegalPlays(hand, null, '2');
    expect(plays.some((p) => p.kind === 'pair' && p.rank === 'BJ')).toBe(false);
  });

  it('does NOT double-enumerate plays of level rank when wildcards present', () => {
    // At level 2, 2♥ is the wildcard. Hand: 2♠, 2♥. The byRank loop already
    // enumerates pair 2 (both cards have rank '2'). The G-C4 synthesis
    // would also try to make pair 2 using the wildcard. Verify no duplicate.
    const hand: Card[] = [c('spades', '2'), c('hearts', '2')];
    const plays = enumerateLegalPlays(hand, null, '2');
    const pair2s = plays.filter((p) => p.kind === 'pair' && p.rank === '2');
    // Exactly one pair-of-2 enumeration. G-C4 skips levelRank to avoid this dup.
    expect(pair2s.length).toBe(1);
  });
});
