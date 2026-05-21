import { describe, expect, it } from 'vitest';
import { detectTributeMode4P, detectTributeModeMP } from '@lib/game/tribute';
import type { PlayerSeat } from '@lib/game/round';
import type { Card } from '@lib/game/cards';

const SEATS_4P: PlayerSeat[] = [
  { id: 'a', team: 't1', position: 0 },
  { id: 'b', team: 't2', position: 1 },
  { id: 'c', team: 't1', position: 2 },
  { id: 'd', team: 't2', position: 3 },
];

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

const emptyHands = (): Record<string, Card[]> =>
  Object.fromEntries(SEATS_4P.map((s) => [s.id, []]));

// ─── single tribute ───────────────────────────────────────────────────────────

describe('detectTributeMode4P — single tribute (1,3) and (1,4)', () => {
  it('finishOrder (a, b, c, d): t1 wins (1,3) — single from 4th (d) to 1st (a)', () => {
    // a (t1) 1st, b (t2) 2nd, c (t1) 3rd, d (t2) 4th → t1 ranks {1,3}
    const mode = detectTributeMode4P(['a', 'b', 'c', 'd'], SEATS_4P, emptyHands());
    expect(mode.kind).toBe('single');
    if (mode.kind === 'single') {
      expect(mode.from).toBe('d');
      expect(mode.to).toBe('a');
    }
  });

  it('finishOrder (a, b, d, c): t1 wins (1,4) — single from 4th (c) to 1st (a)', () => {
    // a (t1) 1st, b (t2) 2nd, d (t2) 3rd, c (t1) 4th → t1 ranks {1,4}
    const mode = detectTributeMode4P(['a', 'b', 'd', 'c'], SEATS_4P, emptyHands());
    expect(mode.kind).toBe('single');
    if (mode.kind === 'single') {
      expect(mode.from).toBe('c');
      expect(mode.to).toBe('a');
    }
  });
});

// ─── double tribute ───────────────────────────────────────────────────────────

describe('detectTributeMode4P — double tribute (1,2)', () => {
  it('finishOrder (a, c, b, d): t1 wins (1,2) — both t2 players tribute to both t1', () => {
    // a (t1) 1st, c (t1) 2nd, b (t2) 3rd, d (t2) 4th
    const mode = detectTributeMode4P(['a', 'c', 'b', 'd'], SEATS_4P, emptyHands());
    expect(mode.kind).toBe('double');
    if (mode.kind === 'double') {
      const fromIds = mode.obligations.map((o) => o.from).sort();
      const toIds = mode.obligations.map((o) => o.to).sort();
      expect(fromIds).toEqual(['b', 'd']);
      expect(toIds).toEqual(['a', 'c']);
      // 末游 (d) tributes to 头游 (a)
      const dObligation = mode.obligations.find((o) => o.from === 'd');
      expect(dObligation?.to).toBe('a');
    }
  });
});

// ─── 抗贡 — resist tribute ────────────────────────────────────────────────────

describe('detectTributeMode4P — 抗贡 (resist tribute)', () => {
  it('single scenario, 4th holds both RJs → resist', () => {
    const hands = emptyHands();
    hands['d'] = [c('joker', 'RJ', 1), c('joker', 'RJ', 2)];
    const mode = detectTributeMode4P(['a', 'b', 'c', 'd'], SEATS_4P, hands);
    expect(mode.kind).toBe('resist');
  });

  it('single scenario, 4th holds 1 RJ + 1 BJ → NOT resist (need both RJs)', () => {
    const hands = emptyHands();
    hands['d'] = [c('joker', 'RJ', 1), c('joker', 'BJ', 1)];
    const mode = detectTributeMode4P(['a', 'b', 'c', 'd'], SEATS_4P, hands);
    expect(mode.kind).toBe('single'); // not resist
  });

  it('double scenario, losers collectively hold both RJs → resist', () => {
    const hands = emptyHands();
    // 3rd (b) holds 1 RJ; 4th (d) holds the other RJ
    hands['b'] = [c('joker', 'RJ', 1)];
    hands['d'] = [c('joker', 'RJ', 2)];
    const mode = detectTributeMode4P(['a', 'c', 'b', 'd'], SEATS_4P, hands);
    expect(mode.kind).toBe('resist');
  });

  it('double scenario, only 1 RJ split between losers → NOT resist', () => {
    const hands = emptyHands();
    hands['b'] = [c('joker', 'RJ', 1)];
    hands['d'] = [c('joker', 'BJ', 1)]; // BJ not RJ
    const mode = detectTributeMode4P(['a', 'c', 'b', 'd'], SEATS_4P, hands);
    expect(mode.kind).toBe('double'); // not resist
  });
});

// ─── input validation ────────────────────────────────────────────────────────

describe('detectTributeMode4P — validation', () => {
  it('throws if finishOrder has wrong length', () => {
    expect(() =>
      detectTributeMode4P(['a', 'b'], SEATS_4P, emptyHands())
    ).toThrow(/4 entries/);
  });

  it('throws if seats are not 4P', () => {
    expect(() =>
      detectTributeMode4P(
        ['a', 'b', 'c', 'd'],
        SEATS_4P.slice(0, 3),
        emptyHands()
      )
    ).toThrow(/4 seats/);
  });
});

// ─── detectTributeModeMP — 6P / 8P sweep tribute ──────────────────────────────

const SEATS_6P: PlayerSeat[] = [
  { id: 'a', team: 't1', position: 0 },
  { id: 'b', team: 't2', position: 1 },
  { id: 'c', team: 't1', position: 2 },
  { id: 'd', team: 't2', position: 3 },
  { id: 'e', team: 't1', position: 4 },
  { id: 'f', team: 't2', position: 5 },
];

const SEATS_8P: PlayerSeat[] = [
  { id: 'a', team: 't1', position: 0 },
  { id: 'b', team: 't2', position: 1 },
  { id: 'c', team: 't1', position: 2 },
  { id: 'd', team: 't2', position: 3 },
  { id: 'e', team: 't1', position: 4 },
  { id: 'f', team: 't2', position: 5 },
  { id: 'g', team: 't1', position: 6 },
  { id: 'h', team: 't2', position: 7 },
];

const emptyHands6P = (): Record<string, Card[]> =>
  Object.fromEntries(SEATS_6P.map((s) => [s.id, []]));

const emptyHands8P = (): Record<string, Card[]> =>
  Object.fromEntries(SEATS_8P.map((s) => [s.id, []]));

describe('detectTributeModeMP — 6P sweep (top 3 same team)', () => {
  it('t1 holds 1,2,3 → sweep, 3 obligations with 末游→头游 pairings', () => {
    // a (t1) 1st, c (t1) 2nd, e (t1) 3rd → top-3 all t1 → sweep
    // f (t2) 4th, d (t2) 5th, b (t2) 6th
    // Pairings: b→a (6→1), d→c (5→2), f→e (4→3)
    const mode = detectTributeModeMP(
      '6',
      ['a', 'c', 'e', 'f', 'd', 'b'],
      SEATS_6P,
      emptyHands6P()
    );
    expect(mode.kind).toBe('sweep');
    if (mode.kind === 'sweep') {
      expect(mode.obligations).toHaveLength(3);
      const pairs = mode.obligations.map((o) => `${o.from}→${o.to}`).sort();
      expect(pairs).toEqual(['b→a', 'd→c', 'f→e']);
    }
  });

  it('t2 sweeps (b,d,f take 1,2,3) → sweep with reversed roles', () => {
    const mode = detectTributeModeMP(
      '6',
      ['b', 'd', 'f', 'a', 'c', 'e'],
      SEATS_6P,
      emptyHands6P()
    );
    expect(mode.kind).toBe('sweep');
    if (mode.kind === 'sweep') {
      // Pairings: e→b (6→1), c→d (5→2), a→f (4→3)
      const pairs = mode.obligations.map((o) => `${o.from}→${o.to}`).sort();
      expect(pairs).toEqual(['a→f', 'c→d', 'e→b']);
    }
  });
});

describe('detectTributeModeMP — 6P mixed (path A single)', () => {
  it('t1 takes 1, 3, 5 — mixed → single tribute (6th → 1st)', () => {
    // Not all top-3 on same team → no sweep → single fallback.
    const mode = detectTributeModeMP(
      '6',
      ['a', 'b', 'c', 'd', 'e', 'f'],
      SEATS_6P,
      emptyHands6P()
    );
    expect(mode.kind).toBe('single');
    if (mode.kind === 'single') {
      expect(mode.from).toBe('f');
      expect(mode.to).toBe('a');
    }
  });
});

describe('detectTributeModeMP — 8P sweep (top 4 same team)', () => {
  it('t1 holds 1,2,3,4 → sweep with 4 obligations', () => {
    // finishOrder: a(1) c(2) e(3) g(4) h(5) f(6) d(7) b(8)
    // Spec pairings: 5→4 h→g, 6→3 f→e, 7→2 d→c, 8→1 b→a
    const mode = detectTributeModeMP(
      '8',
      ['a', 'c', 'e', 'g', 'h', 'f', 'd', 'b'],
      SEATS_8P,
      emptyHands8P()
    );
    expect(mode.kind).toBe('sweep');
    if (mode.kind === 'sweep') {
      expect(mode.obligations).toHaveLength(4);
      const pairs = mode.obligations.map((o) => `${o.from}→${o.to}`).sort();
      expect(pairs).toEqual(['b→a', 'd→c', 'f→e', 'h→g']);
    }
  });
});

describe('detectTributeModeMP — 8P mixed (path A single)', () => {
  it('alternating finish → single tribute (8th → 1st)', () => {
    const mode = detectTributeModeMP(
      '8',
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      SEATS_8P,
      emptyHands8P()
    );
    expect(mode.kind).toBe('single');
    if (mode.kind === 'single') {
      expect(mode.from).toBe('h');
      expect(mode.to).toBe('a');
    }
  });
});

describe('detectTributeModeMP — resist precedence over sweep', () => {
  it('6P sweep but losing team holds both RJs → resist wins', () => {
    const hands = emptyHands6P();
    hands['f'] = [c('joker', 'RJ', 1)];
    hands['b'] = [c('joker', 'RJ', 2)];
    const mode = detectTributeModeMP(
      '6',
      ['a', 'c', 'e', 'f', 'd', 'b'],
      SEATS_6P,
      hands
    );
    expect(mode.kind).toBe('resist');
  });

  it('8P sweep but losing team holds both RJs → resist wins', () => {
    const hands = emptyHands8P();
    hands['h'] = [c('joker', 'RJ', 1)];
    hands['f'] = [c('joker', 'RJ', 2)];
    const mode = detectTributeModeMP(
      '8',
      ['a', 'c', 'e', 'g', 'h', 'f', 'd', 'b'],
      SEATS_8P,
      hands
    );
    expect(mode.kind).toBe('resist');
  });

  it('resist requires BOTH red jokers (one RJ + one BJ → no resist)', () => {
    const hands = emptyHands6P();
    hands['f'] = [c('joker', 'RJ', 1), c('joker', 'BJ', 1)];
    const mode = detectTributeModeMP(
      '6',
      ['a', 'c', 'e', 'f', 'd', 'b'],
      SEATS_6P,
      hands
    );
    expect(mode.kind).toBe('sweep'); // not resist — only 1 RJ on losing team
  });
});

describe('detectTributeModeMP — validation', () => {
  it('throws if finishOrder length wrong for 6P', () => {
    expect(() =>
      detectTributeModeMP('6', ['a', 'b'], SEATS_6P, emptyHands6P())
    ).toThrow(/6/);
  });

  it('throws if seats length wrong for 8P', () => {
    expect(() =>
      detectTributeModeMP(
        '8',
        ['a', 'c', 'e', 'g', 'h', 'f', 'd', 'b'],
        SEATS_8P.slice(0, 6),
        emptyHands8P()
      )
    ).toThrow(/8/);
  });
});
