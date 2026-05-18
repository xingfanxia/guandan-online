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
