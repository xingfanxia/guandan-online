import { describe, expect, it } from 'vitest';
import { calculateUpgrade } from '@lib/game/upgrade';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

const RULES = DEFAULT_MODE_RULES;

describe('calculateUpgrade — 4-player', () => {
  it('positions (1,2) → +3 levels (双下)', () => {
    const r = calculateUpgrade({ mode: '4', ranks: [1, 2], rules: RULES });
    expect(r.upgrade).toBe(3);
    expect(r.details.mode).toBe('4-player');
    expect(r.details.combination).toBe('1,2');
  });

  it('positions (1,3) → +2 levels', () => {
    const r = calculateUpgrade({ mode: '4', ranks: [1, 3], rules: RULES });
    expect(r.upgrade).toBe(2);
    expect(r.details.combination).toBe('1,3');
  });

  it('positions (1,4) → +1 level', () => {
    const r = calculateUpgrade({ mode: '4', ranks: [1, 4], rules: RULES });
    expect(r.upgrade).toBe(1);
    expect(r.details.combination).toBe('1,4');
  });

  it('non-table positions → 0 (e.g., (2,3) — winning team without 1st)', () => {
    const r = calculateUpgrade({ mode: '4', ranks: [2, 3], rules: RULES });
    expect(r.upgrade).toBe(0);
  });

  it('rejects wrong-length input', () => {
    const r = calculateUpgrade({ mode: '4', ranks: [1], rules: RULES });
    expect(r.upgrade).toBe(0);
    expect(r.error).toContain('requires 2');
  });
});

describe('calculateUpgrade — 6-player', () => {
  it('(1,2,3) → score 5+4+3=12 vs 3+1+0=4 diff=+8 → +3 (≥g3=7)', () => {
    const r = calculateUpgrade({ mode: '6', ranks: [1, 2, 3], rules: RULES });
    expect(r.details.ourScore).toBe(12);
    expect(r.details.oppScore).toBe(4);
    expect(r.details.difference).toBe(8);
    expect(r.upgrade).toBe(3);
  });

  it('(1,3,5) → 5+3+1=9 vs 4+3+0=7 diff=+2 → +1 (≥g1=1)', () => {
    const r = calculateUpgrade({ mode: '6', ranks: [1, 3, 5], rules: RULES });
    expect(r.details.difference).toBe(2);
    expect(r.upgrade).toBe(1);
  });

  it('(1,4,5) → 5+3+1=9 vs 4+3+0=7 diff=+2 → +1', () => {
    const r = calculateUpgrade({ mode: '6', ranks: [1, 4, 5], rules: RULES });
    expect(r.details.difference).toBe(2);
    expect(r.upgrade).toBe(1);
  });

  it('(1,5,6) → 5+1+0=6 vs 4+3+3=10 diff=-4 → 0', () => {
    const r = calculateUpgrade({ mode: '6', ranks: [1, 5, 6], rules: RULES });
    expect(r.details.difference).toBe(-4);
    expect(r.upgrade).toBe(0);
  });

  it('without 1st place: must1=true (default) → 0', () => {
    const r = calculateUpgrade({ mode: '6', ranks: [2, 3, 4], rules: RULES });
    expect(r.upgrade).toBe(0);
    expect(r.details.hasFirstPlace).toBe(false);
  });

  it('without 1st place: must1=false override → uses tier()', () => {
    const r = calculateUpgrade({ mode: '6', ranks: [2, 3, 4], rules: RULES, must1: false });
    expect(r.details.hasFirstPlace).toBe(false);
    expect(r.upgrade).toBeGreaterThanOrEqual(0);
  });

  it('rejects wrong-length input', () => {
    const r = calculateUpgrade({ mode: '6', ranks: [1, 2], rules: RULES });
    expect(r.upgrade).toBe(0);
    expect(r.error).toContain('requires 3');
  });
});

describe('calculateUpgrade — 8-player', () => {
  it('sweep (1,2,3,4) → +4 (bonus), bypasses diff calc', () => {
    const r = calculateUpgrade({ mode: '8', ranks: [1, 2, 3, 4], rules: RULES });
    expect(r.upgrade).toBe(4);
    expect(r.details.sweepBonus).toBe(true);
  });

  it('(1,2,3,5) → 7+6+5+3=21 vs 4+3+2+1+0=10... wait, opp = 28-21=7 diff=+14 → +3 (≥g3=11)', () => {
    // total p8 = 7+6+5+4+3+2+1+0 = 28. ourScore=7+6+5+3=21. oppScore=28-21=7. diff=14.
    const r = calculateUpgrade({ mode: '8', ranks: [1, 2, 3, 5], rules: RULES });
    expect(r.details.ourScore).toBe(21);
    expect(r.details.oppScore).toBe(7);
    expect(r.details.difference).toBe(14);
    expect(r.upgrade).toBe(3);
  });

  it('(1,3,5,7) → ourScore=7+5+3+1=16 oppScore=28-16=12 diff=+4 → +1 (≥g1=0; not ≥g2=5)', () => {
    const r = calculateUpgrade({ mode: '8', ranks: [1, 3, 5, 7], rules: RULES });
    expect(r.details.ourScore).toBe(16);
    expect(r.details.oppScore).toBe(12);
    expect(r.details.difference).toBe(4);
    expect(r.upgrade).toBe(1);
  });

  it('(1,2,7,8) → 7+6+1+0=14 vs 28-14=14 diff=0 → +1 (≥g1=0)', () => {
    const r = calculateUpgrade({ mode: '8', ranks: [1, 2, 7, 8], rules: RULES });
    expect(r.details.difference).toBe(0);
    expect(r.upgrade).toBe(1);
  });

  it('without 1st place: must1=true → 0', () => {
    const r = calculateUpgrade({ mode: '8', ranks: [2, 3, 4, 5], rules: RULES });
    expect(r.upgrade).toBe(0);
    expect(r.details.hasFirstPlace).toBe(false);
  });

  it('sweep takes precedence over must1 (1 is in the sweep)', () => {
    const r = calculateUpgrade({ mode: '8', ranks: [1, 2, 3, 4], rules: RULES });
    expect(r.upgrade).toBe(4);
  });

  it('rejects wrong-length input', () => {
    const r = calculateUpgrade({ mode: '8', ranks: [1, 2, 3], rules: RULES });
    expect(r.upgrade).toBe(0);
    expect(r.error).toContain('requires 4');
  });
});

describe('calculateUpgrade — input safety', () => {
  it('handles non-array ranks gracefully', () => {
    // @ts-expect-error — runtime defense for malformed callers
    const r = calculateUpgrade({ mode: '4', ranks: null, rules: RULES });
    expect(r.upgrade).toBe(0);
    expect(r.error).toBeDefined();
  });
});
