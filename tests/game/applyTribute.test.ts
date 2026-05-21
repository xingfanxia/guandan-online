import { describe, expect, it } from 'vitest';
import { applyTribute } from '@lib/game/tribute';
import type { Card } from '@lib/game/cards';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

// ─── 'none' mode (first round of session) ─────────────────────────────────────

describe('applyTribute — none', () => {
  it('returns hands unchanged; firstLeader = 1st place', () => {
    const hands = {
      a: [c('spades', '5')],
      b: [c('hearts', '5')],
      c: [c('clubs', '5')],
      d: [c('diamonds', '5')],
    };
    const result = applyTribute(hands, { kind: 'none' }, ['a', 'b', 'c', 'd'], '2');
    expect(result.newHands).toEqual(hands);
    expect(result.firstLeader).toBe('a');
    expect(result.exchanges).toEqual([]);
  });
});

// ─── 'resist' — losers held both RJs ──────────────────────────────────────────

describe('applyTribute — resist', () => {
  it('returns hands unchanged; firstLeader = 1st place (winners retain advantage)', () => {
    const hands = {
      a: [c('spades', 'A')],
      b: [c('hearts', '5')],
      c: [c('clubs', 'K')],
      d: [c('joker', 'RJ', 1), c('joker', 'RJ', 2)],
    };
    const result = applyTribute(hands, { kind: 'resist' }, ['a', 'b', 'c', 'd'], '2');
    expect(result.newHands).toEqual(hands);
    expect(result.firstLeader).toBe('a');
  });
});

// ─── 'single' — 4th tributes to 1st, 1st returns; 4th leads ──────────────────

describe('applyTribute — single tribute', () => {
  it('moves the highest non-wildcard from 4th to 1st, return card flows back', () => {
    const hands = {
      a: [c('spades', '3'), c('hearts', '4'), c('clubs', '10')], // 1st place
      b: [c('hearts', '6')],
      c: [c('clubs', '7')],
      d: [c('joker', 'RJ'), c('diamonds', '5')], // 4th place: has RJ
    };
    const result = applyTribute(
      hands,
      { kind: 'single', from: 'd', to: 'a' },
      ['a', 'b', 'c', 'd'],
      '2'
    );
    // d's highest (RJ) goes to a. a returns smallest ≤10 = '3'-spades.
    // After: d loses RJ, gains '3'-spades. a loses '3'-spades, gains RJ.
    expect(result.newHands['d']).toContainEqual(c('diamonds', '5'));
    expect(result.newHands['d']).toContainEqual(c('spades', '3'));
    expect(result.newHands['d']).not.toContainEqual(c('joker', 'RJ'));
    expect(result.newHands['a']).toContainEqual(c('joker', 'RJ'));
    expect(result.newHands['a']).toContainEqual(c('hearts', '4'));
    expect(result.newHands['a']).toContainEqual(c('clubs', '10'));
    expect(result.newHands['a']).not.toContainEqual(c('spades', '3'));
    // 4th leads
    expect(result.firstLeader).toBe('d');
    // Exchange record
    expect(result.exchanges).toHaveLength(1);
    expect(result.exchanges[0]?.from).toBe('d');
    expect(result.exchanges[0]?.to).toBe('a');
    expect(result.exchanges[0]?.tribute).toEqual(c('joker', 'RJ'));
    expect(result.exchanges[0]?.return).toEqual(c('spades', '3'));
  });

  it('preserves the rest of every player\'s hand (only the tribute pair moves)', () => {
    const hands = {
      a: [c('spades', '10'), c('hearts', '4')],
      b: [c('hearts', '6')],
      c: [c('clubs', '7')],
      d: [c('joker', 'RJ'), c('diamonds', '5')],
    };
    const result = applyTribute(
      hands,
      { kind: 'single', from: 'd', to: 'a' },
      ['a', 'b', 'c', 'd'],
      '2'
    );
    // b and c hands unchanged
    expect(result.newHands['b']).toEqual(hands['b']);
    expect(result.newHands['c']).toEqual(hands['c']);
  });
});

// ─── 'double' — both losers tribute, both winners return ─────────────────────

describe('applyTribute — double tribute', () => {
  it('processes both obligations; 末游 (4th) leads', () => {
    const hands = {
      a: [c('spades', '3'), c('hearts', '4')], // 1st (t1)
      c: [c('clubs', '5'), c('diamonds', '6')], // 2nd (t1)
      b: [c('hearts', '10'), c('clubs', 'J')], // 3rd (t2)
      d: [c('joker', 'BJ'), c('diamonds', '7')], // 4th (t2)
    };
    const result = applyTribute(
      hands,
      {
        kind: 'double',
        obligations: [
          { from: 'd', to: 'a' },
          { from: 'b', to: 'c' },
        ],
      },
      ['a', 'c', 'b', 'd'], // finishOrder
      '2'
    );
    expect(result.firstLeader).toBe('d'); // 末游 leads
    // Two exchanges recorded
    expect(result.exchanges).toHaveLength(2);
    // d's highest (BJ) moves to a
    expect(result.newHands['a']).toContainEqual(c('joker', 'BJ'));
    // a returns smallest ≤10 (3-spades)
    expect(result.newHands['d']).toContainEqual(c('spades', '3'));
    // b's highest (J) moves to c
    expect(result.newHands['c']).toContainEqual(c('clubs', 'J'));
    // c returns smallest (5-clubs)
    expect(result.newHands['b']).toContainEqual(c('clubs', '5'));
  });
});

describe('applyTribute — sweep tribute (6P/8P)', () => {
  it('6P 3-pair sweep: 末游 (last) leads, 3 exchanges recorded', () => {
    // Use level '5' so no natural rank is a trump (avoids '2' being highest at
    // level 2, which would otherwise mask plain-A tributes).
    // 6P sweep finish: a,c,e (t1) take 1,2,3; f,d,b (t2) take 4,5,6.
    // Pairings: b→a (6→1), d→c (5→2), f→e (4→3)
    const hands = {
      a: [c('spades', '3'), c('hearts', '4')],
      c: [c('clubs', '6'), c('diamonds', '7')],
      e: [c('spades', '8'), c('hearts', '9')],
      f: [c('clubs', '10'), c('diamonds', 'J')], // 4th tributes J to e
      d: [c('clubs', '3'), c('hearts', 'K')],    // 5th tributes K to c
      b: [c('spades', 'A'), c('diamonds', '2')], // 6th tributes A to a
    };
    const result = applyTribute(
      hands,
      {
        kind: 'sweep',
        obligations: [
          { from: 'b', to: 'a' },
          { from: 'd', to: 'c' },
          { from: 'f', to: 'e' },
        ],
      },
      ['a', 'c', 'e', 'f', 'd', 'b'],
      '5' // level 5 — no rank-2 trump distortion
    );
    expect(result.firstLeader).toBe('b'); // 末游 leads
    expect(result.exchanges).toHaveLength(3);
    expect(result.newHands['a']).toContainEqual(c('spades', 'A'));
    expect(result.newHands['c']).toContainEqual(c('hearts', 'K'));
    expect(result.newHands['e']).toContainEqual(c('diamonds', 'J'));
  });

  it('8P 4-pair sweep: 4 exchanges, last position leads', () => {
    const hands = {
      a: [c('spades', '3')], b: [c('spades', 'A')],
      c: [c('clubs', '6')], d: [c('clubs', 'K')],
      e: [c('hearts', '7')], f: [c('hearts', 'Q')],
      g: [c('diamonds', '9')], h: [c('diamonds', 'J')],
    };
    const result = applyTribute(
      hands,
      {
        kind: 'sweep',
        obligations: [
          { from: 'h', to: 'a' },
          { from: 'f', to: 'c' },
          { from: 'd', to: 'e' },
          { from: 'b', to: 'g' },
        ],
      },
      ['a', 'c', 'e', 'g', 'h', 'f', 'd', 'b'],
      '5'
    );
    expect(result.firstLeader).toBe('b');
    expect(result.exchanges).toHaveLength(4);
    expect(result.newHands['a']).toContainEqual(c('diamonds', 'J'));
    expect(result.newHands['c']).toContainEqual(c('hearts', 'Q'));
    expect(result.newHands['e']).toContainEqual(c('clubs', 'K'));
    expect(result.newHands['g']).toContainEqual(c('spades', 'A'));
  });
});

// ─── Edge: tribute card unavailable ──────────────────────────────────────────

describe('applyTribute — edge cases', () => {
  it('throws if loser hand is empty of tributable cards (all wildcards)', () => {
    const hands = {
      a: [c('spades', 'A')],
      b: [c('hearts', '6')],
      c: [c('clubs', '7')],
      d: [c('hearts', '5', 1), c('hearts', '5', 2)], // all wildcards at level 5
    };
    expect(() =>
      applyTribute(
        hands,
        { kind: 'single', from: 'd', to: 'a' },
        ['a', 'b', 'c', 'd'],
        '5'
      )
    ).toThrow(/tribute|wildcard/i);
  });
});
