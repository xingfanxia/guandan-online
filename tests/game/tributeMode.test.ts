import { describe, expect, it } from 'vitest';
import { detectTributeMode4P } from '@lib/game/tribute';
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
