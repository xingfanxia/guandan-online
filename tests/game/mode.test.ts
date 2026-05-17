import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODE_RULES,
  positionCount,
  winningRankCount,
  tracksAFail,
} from '@lib/game/mode';

describe('DEFAULT_MODE_RULES', () => {
  it('matches sibling scorer config.js:22-54 for 4-player table', () => {
    expect(DEFAULT_MODE_RULES.c4).toEqual({ '1,2': 3, '1,3': 2, '1,4': 1 });
  });

  it('matches sibling scorer for 6-player thresholds + points', () => {
    expect(DEFAULT_MODE_RULES.t6).toEqual({ g3: 7, g2: 4, g1: 1 });
    expect(DEFAULT_MODE_RULES.p6).toEqual({ 1: 5, 2: 4, 3: 3, 4: 3, 5: 1, 6: 0 });
  });

  it('matches sibling scorer live config for 8-player (g2:5 g1:0 per game-rules.md note)', () => {
    expect(DEFAULT_MODE_RULES.t8).toEqual({ g3: 11, g2: 5, g1: 0 });
    expect(DEFAULT_MODE_RULES.p8).toEqual({ 1: 7, 2: 6, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 0 });
  });

  it('preferences default to enforcement-on (must1 + strictA)', () => {
    expect(DEFAULT_MODE_RULES.must1).toBe(true);
    expect(DEFAULT_MODE_RULES.strictA).toBe(true);
  });
});

describe('positionCount', () => {
  it('returns 4 / 6 / 8 for the three modes', () => {
    expect(positionCount('4')).toBe(4);
    expect(positionCount('6')).toBe(6);
    expect(positionCount('8')).toBe(8);
  });
});

describe('winningRankCount', () => {
  it('returns 2 / 3 / 4 for the three modes (winning team size)', () => {
    expect(winningRankCount('4')).toBe(2);
    expect(winningRankCount('6')).toBe(3);
    expect(winningRankCount('8')).toBe(4);
  });
});

describe('tracksAFail', () => {
  it('only 4-player tracks A-fail (3-strike demotion)', () => {
    expect(tracksAFail('4')).toBe(true);
    expect(tracksAFail('6')).toBe(false);
    expect(tracksAFail('8')).toBe(false);
  });
});
