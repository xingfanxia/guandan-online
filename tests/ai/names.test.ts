import { describe, expect, it } from 'vitest';
import seedrandom from 'seedrandom';
import { generateBotName, TIER_BADGES, BOT_HANDLE_POOL } from '@lib/ai/names';

describe('generateBotName — shape', () => {
  it('returns a handle starting with "@"', () => {
    const { handle } = generateBotName('easy', seedrandom('shape-1'));
    expect(handle.startsWith('@')).toBe(true);
  });

  it('handle body is one of the canonical pool entries (no random unicode)', () => {
    const { handle } = generateBotName('medium', seedrandom('pool-1'));
    const body = handle.slice(1);
    expect(BOT_HANDLE_POOL).toContain(body);
  });
});

describe('generateBotName — tier badges', () => {
  it('easy + medium each get distinct badges', () => {
    const e = generateBotName('easy', seedrandom('t-1')).badge;
    const m = generateBotName('medium', seedrandom('t-2')).badge;
    expect(new Set([e, m]).size).toBe(2);
  });

  it('badge matches the TIER_BADGES table', () => {
    expect(generateBotName('easy', seedrandom('t-e')).badge).toBe(TIER_BADGES.easy);
    expect(generateBotName('medium', seedrandom('t-m')).badge).toBe(TIER_BADGES.medium);
  });
});

describe('generateBotName — determinism + diversity', () => {
  it('same seed → same handle', () => {
    const a = generateBotName('easy', seedrandom('det-1')).handle;
    const b = generateBotName('easy', seedrandom('det-1')).handle;
    expect(a).toBe(b);
  });

  it('100 seeds produce typically >10 distinct handles (sanity check pool sampling)', () => {
    const handles = new Set<string>();
    for (let i = 0; i < 100; i++) {
      handles.add(generateBotName('easy', seedrandom(`div-${i}`)).handle);
    }
    expect(handles.size).toBeGreaterThan(10);
  });
});
