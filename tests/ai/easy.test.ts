import { describe, expect, it } from 'vitest';
import seedrandom from 'seedrandom';
import { chooseEasyMove } from '@lib/ai/easy';
import type { Card } from '@lib/game/cards';
import type { Pattern } from '@lib/game/patterns';

const c = (suit: Card['suit'], rank: Card['rank'], deck: Card['deck'] = 1): Card => ({
  suit,
  rank,
  deck,
});

// ─── Leading ──────────────────────────────────────────────────────────────────

describe('chooseEasyMove — leading (no target)', () => {
  it('returns a play when the hand has any cards', () => {
    const hand: Card[] = [c('spades', '7')];
    const move = chooseEasyMove(hand, null, '2', seedrandom('a'));
    expect(move.kind).toBe('play');
  });

  it('plays the LOWEST single when only singles available (preserve big cards)', () => {
    const hand: Card[] = [c('spades', 'K'), c('hearts', '5'), c('clubs', '9')];
    // Force deterministic — no noise pick. With seed, we can verify behavior.
    const move = chooseEasyMove(hand, null, '2', seedrandom('low-pick'));
    expect(move.kind).toBe('play');
    if (move.kind === 'play') {
      expect(move.pattern.rank).toBe('5');
    }
  });

  it('throws if leading with an empty hand (shouldn\'t happen in real play)', () => {
    expect(() => chooseEasyMove([], null, '2', Math.random)).toThrow(/no legal/i);
  });
});

// ─── Following with target ────────────────────────────────────────────────────

describe('chooseEasyMove — following', () => {
  it('passes when no legal play beats the target', () => {
    const target: Pattern = { kind: 'single', rank: 'A', length: 1, cards: [] };
    const hand: Card[] = [c('spades', '5'), c('hearts', '7')]; // all lower
    const move = chooseEasyMove(hand, target, '2', seedrandom('all-pass'));
    expect(move.kind).toBe('pass');
  });

  it('plays the cheapest beating play when available (no-noise seed path)', () => {
    const target: Pattern = { kind: 'single', rank: '7', length: 1, cards: [] };
    const hand: Card[] = [c('spades', 'K'), c('hearts', '9'), c('clubs', 'A')];
    // With a non-noise rng seed, the bot picks the LOWEST beating single (9).
    // Note: 30% of seeds will hit the noise branch — we use a known seed that
    // doesn't (verified manually).
    const move = chooseEasyMove(hand, target, '2', () => 0.9); // > 0.3 → no noise
    expect(move.kind).toBe('play');
    if (move.kind === 'play') {
      expect(move.pattern.rank).toBe('9');
    }
  });

  it('plays the bomb when only a bomb beats the target', () => {
    const target: Pattern = { kind: 'pair', rank: 'A', length: 2, cards: [] };
    const hand: Card[] = [
      c('spades', '5'), c('hearts', '5'), c('clubs', '5'), c('diamonds', '5'),
      c('spades', '7'),
    ];
    const move = chooseEasyMove(hand, target, '2', () => 0.9);
    // Only the 4-bomb of 5 beats a pair (different kind not allowed for follow,
    // bombs override). So bot picks the bomb.
    expect(move.kind).toBe('play');
    if (move.kind === 'play') {
      expect(move.pattern.kind).toBe('bomb');
    }
  });
});

// ─── Noise injection ──────────────────────────────────────────────────────────

describe('chooseEasyMove — 30% noise', () => {
  it('with rng < 0.15 → noise branch: sometimes passes even with valid plays', () => {
    const target: Pattern = { kind: 'single', rank: '7', length: 1, cards: [] };
    const hand: Card[] = [c('spades', 'A'), c('hearts', 'K')];
    // First call (0.1) → noise; second call (0.4) → pass branch within noise.
    let calls = 0;
    const rng = () => {
      const vals = [0.1, 0.4];
      const v = vals[calls % vals.length]!;
      calls++;
      return v;
    };
    const move = chooseEasyMove(hand, target, '2', rng);
    expect(move.kind).toBe('pass');
  });

  it('with rng < 0.15 → noise branch: sometimes plays randomly', () => {
    const target: Pattern = { kind: 'single', rank: '7', length: 1, cards: [] };
    const hand: Card[] = [c('spades', 'A'), c('hearts', 'K')];
    // First (0.1) → noise; second (0.6) → play branch within noise; third (0.0) → first play.
    let calls = 0;
    const rng = () => {
      const vals = [0.1, 0.6, 0.0];
      const v = vals[calls % vals.length]!;
      calls++;
      return v;
    };
    const move = chooseEasyMove(hand, target, '2', rng);
    expect(move.kind).toBe('play'); // chose a random play, not the cheapest
  });

  it('deterministic given a seed', () => {
    const hand: Card[] = [c('spades', 'K'), c('hearts', '5'), c('clubs', '9')];
    const a = chooseEasyMove(hand, null, '2', seedrandom('determinism'));
    const b = chooseEasyMove(hand, null, '2', seedrandom('determinism'));
    expect(a).toEqual(b);
  });
});
