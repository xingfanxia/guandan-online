import { describe, expect, it } from 'vitest';
import { analyzeHand, canBeat, powerRank } from '@lib/game/patterns';
import type { Pattern } from '@lib/game/patterns';
import type { Card, NaturalRank, NaturalSuit } from '@lib/game/cards';

const c = (
  suit: Card['suit'],
  rank: Card['rank'],
  deck: Card['deck'] = 1
): Card => ({ suit, rank, deck });

// ─── powerRank: non-sequence comparison (RJ > BJ > level > A > K > … > 2) ─────

describe('powerRank — non-sequence rank ordering', () => {
  it('natural ranks map 1..13 (2 lowest, A highest)', () => {
    expect(powerRank('2', '5')).toBe(1);
    expect(powerRank('K', '5')).toBe(12);
    expect(powerRank('A', '5')).toBe(13);
  });

  it('level rank lifts to 14 (above A)', () => {
    expect(powerRank('5', '5')).toBe(14);
    expect(powerRank('A', 'A')).toBe(14);
  });

  it('jokers above level: BJ=15, RJ=16', () => {
    expect(powerRank('BJ', '5')).toBe(15);
    expect(powerRank('RJ', '5')).toBe(16);
  });

  it('relative ordering holds: RJ > BJ > level > A > K', () => {
    expect(powerRank('RJ', '5')).toBeGreaterThan(powerRank('BJ', '5'));
    expect(powerRank('BJ', '5')).toBeGreaterThan(powerRank('5', '5'));
    expect(powerRank('5', '5')).toBeGreaterThan(powerRank('A', '5'));
    expect(powerRank('A', '5')).toBeGreaterThan(powerRank('K', '5'));
  });
});

// ─── analyzeHand: single ──────────────────────────────────────────────────────

describe('analyzeHand — single', () => {
  it('1 card → single with that card\'s rank', () => {
    const p = analyzeHand([c('spades', '7')], '5');
    expect(p).toMatchObject({ kind: 'single', rank: '7', length: 1 });
  });

  it('joker single — BJ', () => {
    const p = analyzeHand([c('joker', 'BJ')], '5');
    expect(p).toMatchObject({ kind: 'single', rank: 'BJ', length: 1 });
  });

  it('empty array → null', () => {
    expect(analyzeHand([], '5')).toBeNull();
  });
});

// ─── analyzeHand: pair ────────────────────────────────────────────────────────

describe('analyzeHand — pair', () => {
  it('2 of same rank → pair', () => {
    const p = analyzeHand([c('spades', '7'), c('hearts', '7')], '5');
    expect(p).toMatchObject({ kind: 'pair', rank: '7', length: 2 });
  });

  it('2 BJ → pair', () => {
    const p = analyzeHand(
      [c('joker', 'BJ', 1), c('joker', 'BJ', 2)],
      '5'
    );
    expect(p).toMatchObject({ kind: 'pair', rank: 'BJ', length: 2 });
  });

  it('BJ + RJ → null (default: mixed-joker pair disabled per game-rules.md)', () => {
    const p = analyzeHand([c('joker', 'BJ'), c('joker', 'RJ')], '5');
    expect(p).toBeNull();
  });

  it('joker (BJ) + wildcard → null (rule 4: wildcard cannot become a joker)', () => {
    const p = analyzeHand(
      [c('joker', 'BJ'), c('hearts', '5')],
      '5'
    );
    expect(p).toBeNull();
  });

  it('2 different ranks → null (not a valid lead)', () => {
    expect(analyzeHand([c('spades', '7'), c('hearts', '8')], '5')).toBeNull();
  });

  it('1 natural + 1 wildcard (level=5) → pair of natural\'s rank', () => {
    const p = analyzeHand([c('spades', '7'), c('hearts', '5')], '5');
    expect(p).toMatchObject({ kind: 'pair', rank: '7', length: 2 });
  });

  it('2 wildcards alone (level=5) → pair of level rank', () => {
    const p = analyzeHand(
      [c('hearts', '5', 1), c('hearts', '5', 2)],
      '5'
    );
    expect(p).toMatchObject({ kind: 'pair', rank: '5', length: 2 });
  });
});

// ─── analyzeHand: triple ──────────────────────────────────────────────────────

describe('analyzeHand — triple', () => {
  it('3 of same rank → triple', () => {
    const p = analyzeHand(
      [c('spades', '8'), c('hearts', '8'), c('clubs', '8')],
      '5'
    );
    expect(p).toMatchObject({ kind: 'triple', rank: '8', length: 3 });
  });

  it('2 natural + 1 wildcard → triple', () => {
    const p = analyzeHand(
      [c('spades', '8'), c('clubs', '8'), c('hearts', '5')],
      '5'
    );
    expect(p).toMatchObject({ kind: 'triple', rank: '8', length: 3 });
  });

  it('mixed ranks even with wildcard → null', () => {
    expect(
      analyzeHand([c('spades', '8'), c('clubs', '7'), c('hearts', '5')], '5')
    ).toBeNull();
  });
});

// ─── analyzeHand: bomb / jokerBomb pass through bomb.ts ───────────────────────

describe('analyzeHand — bomb pass-through (via bomb.ts)', () => {
  it('4 of a kind → bomb', () => {
    const p = analyzeHand(
      [
        c('spades', '7'), c('hearts', '7'),
        c('clubs', '7'), c('diamonds', '7'),
      ],
      '5'
    );
    expect(p?.kind).toBe('bomb');
    if (p?.kind === 'bomb') {
      expect(p.rank).toBe('7');
      expect(p.length).toBe(4);
    }
  });

  it('4 jokers → jokerBomb', () => {
    const p = analyzeHand(
      [
        c('joker', 'BJ', 1), c('joker', 'BJ', 2),
        c('joker', 'RJ', 1), c('joker', 'RJ', 2),
      ],
      '5'
    );
    expect(p?.kind).toBe('jokerBomb');
  });

  it('5 same suit consecutive → flushStraight (bomb tier)', () => {
    const p = analyzeHand(
      [
        c('spades', '3'), c('spades', '4'), c('spades', '5'),
        c('spades', '6'), c('spades', '7'),
      ],
      '8'
    );
    expect(p?.kind).toBe('flushStraight');
    if (p?.kind === 'flushStraight') {
      expect(p.rank).toBe('7');
    }
  });
});

// ─── analyzeHand: fullHouse (3+2) ─────────────────────────────────────────────

describe('analyzeHand — fullHouse', () => {
  it('triple+pair (different ranks) → fullHouse, rank = triple\'s rank', () => {
    const p = analyzeHand(
      [
        c('spades', '7'), c('hearts', '7'), c('clubs', '7'),
        c('spades', 'K'), c('hearts', 'K'),
      ],
      '5'
    );
    expect(p).toMatchObject({ kind: 'fullHouse', rank: '7', length: 5 });
  });

  it('reverse order — triple of K + pair of 5 → rank K', () => {
    const p = analyzeHand(
      [
        c('spades', '5'), c('hearts', '5'),
        c('spades', 'K'), c('hearts', 'K'), c('clubs', 'K'),
      ],
      '8'
    );
    expect(p).toMatchObject({ kind: 'fullHouse', rank: 'K', length: 5 });
  });

  it('pair+pair (4 cards 2 of each rank) → null', () => {
    expect(
      analyzeHand(
        [c('spades', '7'), c('hearts', '7'), c('clubs', 'K'), c('diamonds', 'K')],
        '5'
      )
    ).toBeNull();
  });

  it('quad + single (4 of A + 1 of K, no wildcards) → null (no valid 5-card pattern)', () => {
    // detectBomb rejects (mixed ranks). tryFullHouse rank-split loop fails (4,1).
    // tryStraight rejects (duplicate ranks). Result: null.
    const p = analyzeHand(
      [
        c('spades', 'A'), c('hearts', 'A'), c('clubs', 'A'),
        c('diamonds', 'A'), c('spades', 'K'),
      ],
      '5'
    );
    expect(p).toBeNull();
  });

  it('5 mixed ranks (no triple) → not fullHouse → tries other kinds', () => {
    // 5,6,7,8,9 of mixed suits → straight, not fullHouse
    const p = analyzeHand(
      [
        c('spades', '5'), c('hearts', '6'), c('clubs', '7'),
        c('diamonds', '8'), c('spades', '9'),
      ],
      'A'
    );
    expect(p?.kind).toBe('straight');
  });
});

// ─── analyzeHand: straight (5 consecutive distinct ranks) ─────────────────────

describe('analyzeHand — straight', () => {
  it('5 consecutive distinct ranks mixed suits → straight, rank = highest', () => {
    const p = analyzeHand(
      [
        c('spades', '5'), c('hearts', '6'), c('clubs', '7'),
        c('diamonds', '8'), c('spades', '9'),
      ],
      'A'
    );
    expect(p).toMatchObject({ kind: 'straight', rank: '9', length: 5 });
  });

  it('A-2-3-4-5 → straight rank 5 (A is low)', () => {
    const p = analyzeHand(
      [
        c('spades', 'A'), c('hearts', '2'), c('clubs', '3'),
        c('diamonds', '4'), c('spades', '5'),
      ],
      '8'
    );
    expect(p).toMatchObject({ kind: 'straight', rank: '5' });
  });

  it('10-J-Q-K-A → straight rank A', () => {
    const p = analyzeHand(
      [
        c('spades', '10'), c('hearts', 'J'), c('clubs', 'Q'),
        c('diamonds', 'K'), c('spades', 'A'),
      ],
      '8'
    );
    expect(p).toMatchObject({ kind: 'straight', rank: 'A' });
  });

  it('J-Q-K-A-2 → null (no wrap)', () => {
    expect(
      analyzeHand(
        [c('spades', 'J'), c('hearts', 'Q'), c('clubs', 'K'),
         c('diamonds', 'A'), c('spades', '2')],
        '5'
      )
    ).toBeNull();
  });

  it('non-consecutive ranks → null', () => {
    expect(
      analyzeHand(
        [c('spades', '5'), c('hearts', '6'), c('clubs', '8'),
         c('diamonds', '9'), c('spades', '10')],
        'A'
      )
    ).toBeNull();
  });

  it('with wildcard filling the gap (5,6,wc,8,9) → straight rank 9', () => {
    const p = analyzeHand(
      [
        c('spades', '5'), c('hearts', '6'),
        c('hearts', 'A'), // wildcard (level=A)
        c('diamonds', '8'), c('spades', '9'),
      ],
      'A'
    );
    expect(p?.kind === 'straight' || p?.kind === 'flushStraight').toBeTruthy();
    expect(p?.rank).toBe('9');
  });
});

// ─── analyzeHand: threePairs (三连对, 3 consecutive pairs) ────────────────────

describe('analyzeHand — threePairs (三连对)', () => {
  it('3-3-4-4-5-5 → threePairs rank 5', () => {
    const p = analyzeHand(
      [
        c('spades', '3'), c('hearts', '3'),
        c('clubs', '4'), c('diamonds', '4'),
        c('spades', '5'), c('hearts', '5'),
      ],
      '8'
    );
    expect(p).toMatchObject({ kind: 'threePairs', rank: '5', length: 6 });
  });

  it('A-A-2-2-3-3 → threePairs rank 3 (A wraps low)', () => {
    const p = analyzeHand(
      [
        c('spades', 'A'), c('hearts', 'A'),
        c('clubs', '2'), c('diamonds', '2'),
        c('spades', '3'), c('hearts', '3'),
      ],
      '8'
    );
    expect(p).toMatchObject({ kind: 'threePairs', rank: '3' });
  });

  it('Q-Q-K-K-A-A → threePairs rank A', () => {
    const p = analyzeHand(
      [
        c('spades', 'Q'), c('hearts', 'Q'),
        c('clubs', 'K'), c('diamonds', 'K'),
        c('spades', 'A'), c('hearts', 'A'),
      ],
      '8'
    );
    expect(p).toMatchObject({ kind: 'threePairs', rank: 'A' });
  });

  it('non-consecutive (3-3-5-5-7-7) → null', () => {
    expect(
      analyzeHand(
        [
          c('spades', '3'), c('hearts', '3'),
          c('clubs', '5'), c('diamonds', '5'),
          c('spades', '7'), c('hearts', '7'),
        ],
        '8'
      )
    ).toBeNull();
  });
});

// ─── analyzeHand: twoTriples (钢板 / 二连三) ──────────────────────────────────

describe('analyzeHand — twoTriples (钢板)', () => {
  it('3 of 5 + 3 of 6 → twoTriples rank 6', () => {
    const p = analyzeHand(
      [
        c('spades', '5'), c('hearts', '5'), c('clubs', '5'),
        c('spades', '6'), c('hearts', '6'), c('clubs', '6'),
      ],
      '8'
    );
    expect(p).toMatchObject({ kind: 'twoTriples', rank: '6', length: 6 });
  });

  it('A-A-A-2-2-2 → twoTriples rank 2 (A as low)', () => {
    const p = analyzeHand(
      [
        c('spades', 'A'), c('hearts', 'A'), c('clubs', 'A'),
        c('spades', '2'), c('hearts', '2'), c('clubs', '2'),
      ],
      '8'
    );
    expect(p).toMatchObject({ kind: 'twoTriples', rank: '2' });
  });

  it('K-K-K-A-A-A → twoTriples rank A', () => {
    const p = analyzeHand(
      [
        c('spades', 'K'), c('hearts', 'K'), c('clubs', 'K'),
        c('spades', 'A'), c('hearts', 'A'), c('clubs', 'A'),
      ],
      '8'
    );
    expect(p).toMatchObject({ kind: 'twoTriples', rank: 'A' });
  });

  it('non-consecutive triples (333 + 555) → null', () => {
    expect(
      analyzeHand(
        [
          c('spades', '3'), c('hearts', '3'), c('clubs', '3'),
          c('spades', '5'), c('hearts', '5'), c('clubs', '5'),
        ],
        '8'
      )
    ).toBeNull();
  });
});

// ─── canBeat: same kind same length → rank comparison ────────────────────────

describe('canBeat — non-bomb same-kind contests', () => {
  const pair = (rank: NaturalRank): Pattern => ({
    kind: 'pair',
    rank,
    length: 2,
    cards: [c('spades', rank), c('hearts', rank)],
  });

  it('pair K beats pair Q', () => {
    expect(canBeat(pair('K'), pair('Q'), '5')).toBe(true);
  });

  it('pair Q does NOT beat pair K', () => {
    expect(canBeat(pair('Q'), pair('K'), '5')).toBe(false);
  });

  it('pair K does NOT beat pair K (must strictly exceed)', () => {
    expect(canBeat(pair('K'), pair('K'), '5')).toBe(false);
  });

  it('pair of level rank beats pair of A', () => {
    expect(canBeat(pair('5'), pair('A'), '5')).toBe(true);
  });
});

describe('canBeat — different kinds disallowed', () => {
  it('pair cannot beat triple (different kind)', () => {
    const pairK: Pattern = {
      kind: 'pair', rank: 'K', length: 2,
      cards: [c('spades', 'K'), c('hearts', 'K')],
    };
    const tripleQ: Pattern = {
      kind: 'triple', rank: 'Q', length: 3,
      cards: [c('spades', 'Q'), c('hearts', 'Q'), c('clubs', 'Q')],
    };
    expect(canBeat(pairK, tripleQ, '5')).toBe(false);
  });

  it('threePairs cannot beat twoTriples (distinct kinds even at same length)', () => {
    const threePairs: Pattern = {
      kind: 'threePairs', rank: 'A', length: 6,
      cards: [],
    };
    const twoTriples: Pattern = {
      kind: 'twoTriples', rank: '5', length: 6,
      cards: [],
    };
    expect(canBeat(threePairs, twoTriples, '8')).toBe(false);
    expect(canBeat(twoTriples, threePairs, '8')).toBe(false);
  });

  it('straight cannot beat flushStraight (flushStraight is a bomb)', () => {
    const straight: Pattern = {
      kind: 'straight', rank: 'A', length: 5,
      cards: [],
    };
    const flushStraight: Pattern = {
      kind: 'flushStraight', rank: '5', length: 5,
      suit: 'spades' as NaturalSuit,
      cards: [],
    };
    expect(canBeat(straight, flushStraight, '8')).toBe(false);
  });
});

describe('canBeat — bomb beats non-bomb', () => {
  const bomb4: Pattern = {
    kind: 'bomb', rank: '2', length: 4,
    cards: [],
  };
  const pairA: Pattern = {
    kind: 'pair', rank: 'A', length: 2,
    cards: [],
  };

  it('4-bomb beats pair', () => {
    expect(canBeat(bomb4, pairA, '5')).toBe(true);
  });

  it('pair cannot beat 4-bomb', () => {
    expect(canBeat(pairA, bomb4, '5')).toBe(false);
  });

  it('flushStraight (bomb tier) beats fullHouse', () => {
    const flushStraight: Pattern = {
      kind: 'flushStraight', rank: '7', length: 5,
      suit: 'spades' as NaturalSuit, cards: [],
    };
    const fullHouse: Pattern = {
      kind: 'fullHouse', rank: 'A', length: 5, cards: [],
    };
    expect(canBeat(flushStraight, fullHouse, '5')).toBe(true);
  });

  it('joker bomb beats all bombs', () => {
    const jb: Pattern = { kind: 'jokerBomb', rank: null, length: 4, cards: [] };
    const eight: Pattern = { kind: 'bomb', rank: 'A', length: 8, cards: [] };
    expect(canBeat(jb, eight, '5')).toBe(true);
    expect(canBeat(eight, jb, '5')).toBe(false);
  });
});

describe('canBeat — bomb-vs-bomb uses tier+rank', () => {
  it('6-bomb beats flushStraight regardless of rank', () => {
    const sixBomb: Pattern = { kind: 'bomb', rank: '2', length: 6, cards: [] };
    const fs: Pattern = {
      kind: 'flushStraight', rank: 'A', length: 5, suit: 'spades', cards: [],
    };
    expect(canBeat(sixBomb, fs, '5')).toBe(true);
  });

  it('same-tier bombs compare by rank', () => {
    const k4: Pattern = { kind: 'bomb', rank: 'K', length: 4, cards: [] };
    const q4: Pattern = { kind: 'bomb', rank: 'Q', length: 4, cards: [] };
    expect(canBeat(k4, q4, '5')).toBe(true);
  });

  it('level-rank 4-bomb beats A 4-bomb', () => {
    const level5: Pattern = { kind: 'bomb', rank: '5', length: 4, cards: [] };
    const aceBomb: Pattern = { kind: 'bomb', rank: 'A', length: 4, cards: [] };
    expect(canBeat(level5, aceBomb, '5')).toBe(true);
  });
});

describe('canBeat — length mismatch disallowed for non-bombs', () => {
  it('pair length 2 cannot beat single length 1', () => {
    const pair: Pattern = { kind: 'pair', rank: 'A', length: 2, cards: [] };
    const single: Pattern = { kind: 'single', rank: 'K', length: 1, cards: [] };
    expect(canBeat(pair, single, '5')).toBe(false);
  });
});
