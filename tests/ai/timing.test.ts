import { describe, expect, it } from 'vitest';
import seedrandom from 'seedrandom';
import { botMoveDelayMs } from '@lib/ai/timing';

describe('botMoveDelayMs — range', () => {
  it('returns delay in the 800–5500 ms range for 1000 samples', () => {
    const rng = seedrandom('range-check');
    for (let i = 0; i < 1000; i++) {
      const d = botMoveDelayMs(rng);
      expect(d).toBeGreaterThanOrEqual(800);
      expect(d).toBeLessThanOrEqual(5500);
    }
  });
});

describe('botMoveDelayMs — distribution shape', () => {
  it('median is well below the midpoint (skewed early — quick-feeling bots)', () => {
    const rng = seedrandom('median-check');
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) samples.push(botMoveDelayMs(rng));
    samples.sort((a, b) => a - b);
    const median = samples[500]!;
    const midpoint = (800 + 5500) / 2; // 3150
    // Beta(2,5) → mean = 2/(2+5) = 0.286 → mapped delay around 800 + 0.286*4700 = 2144
    // Median is similar (slightly below mean for right-skewed Beta). Assert < midpoint.
    expect(median).toBeLessThan(midpoint);
  });

  it('p95 is below the upper bound (slow tail exists but isn\'t pegged)', () => {
    const rng = seedrandom('p95-check');
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) samples.push(botMoveDelayMs(rng));
    samples.sort((a, b) => a - b);
    const p95 = samples[950]!;
    expect(p95).toBeLessThan(5500);
    expect(p95).toBeGreaterThan(2500); // tail is meaningful
  });
});

describe('botMoveDelayMs — determinism', () => {
  it('same seed → same delay sequence', () => {
    const a = seedrandom('determinism');
    const b = seedrandom('determinism');
    for (let i = 0; i < 10; i++) {
      expect(botMoveDelayMs(a)).toBe(botMoveDelayMs(b));
    }
  });
});
