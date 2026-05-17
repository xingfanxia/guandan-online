import { describe, expect, it } from 'vitest';
import { LEVELS, levelIndex, nextLevel, isALevel } from '@lib/game/levels';

describe('LEVELS', () => {
  it('is the canonical 13-rung climb 2 → A', () => {
    expect(LEVELS).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
  });
});

describe('levelIndex', () => {
  it('returns 0 for 2 and 12 for A', () => {
    expect(levelIndex('2')).toBe(0);
    expect(levelIndex('A')).toBe(12);
  });

  it('returns the canonical position for each level', () => {
    LEVELS.forEach((lvl, i) => {
      expect(levelIndex(lvl)).toBe(i);
    });
  });
});

describe('nextLevel', () => {
  it('advances by 1', () => {
    expect(nextLevel('2', 1)).toBe('3');
    expect(nextLevel('10', 1)).toBe('J');
    expect(nextLevel('Q', 1)).toBe('K');
  });

  it('advances by 3 (max single-round upgrade)', () => {
    expect(nextLevel('2', 3)).toBe('5');
    expect(nextLevel('J', 3)).toBe('A'); // J→Q→K→A
  });

  it('advances by 4 (sweep bonus)', () => {
    expect(nextLevel('2', 4)).toBe('6');
    expect(nextLevel('10', 4)).toBe('A'); // 10→J→Q→K→A
  });

  it('clamps at A — cannot upgrade past A via this fn', () => {
    expect(nextLevel('A', 1)).toBe('A');
    expect(nextLevel('A', 5)).toBe('A');
    expect(nextLevel('K', 2)).toBe('A'); // K→A→clamp
    expect(nextLevel('Q', 5)).toBe('A'); // Q→K→A→clamp×3
  });

  it('clamps at 2 (floor) for negative increments — demotion safety net', () => {
    expect(nextLevel('2', -1)).toBe('2');
    expect(nextLevel('5', -5)).toBe('2');
    expect(nextLevel('A', -20)).toBe('2');
  });

  it('handles 0 increment', () => {
    expect(nextLevel('7', 0)).toBe('7');
    expect(nextLevel('A', 0)).toBe('A');
  });
});

describe('isALevel', () => {
  it('only A is the A-level', () => {
    expect(isALevel('A')).toBe(true);
    expect(isALevel('K')).toBe(false);
    expect(isALevel('2')).toBe(false);
  });
});
