// F2 — AI strength ladder proof.
//
// The brief demands that difficulty tiers actually differ in playing strength
// ("no random-play stubs"). This benchmark plays seeded headless 4P rounds and
// asserts a real ordering: medium > easy > random by 头游 (first-finisher)
// win-rate. It is the missing T5 metric — without it, "AI works" tests only
// proved moves were legal, not that they were good.
//
// Scale up for a tighter estimate: BENCH_SEEDS=300 npx vitest run tests/ai/strength.test.ts
// (each seed plays 2 oriented rounds, so games = seeds × 2.)

import { describe, it, expect, beforeAll } from 'vitest';
import { runMatchup, type MatchupResult } from '../../benchmarks/ai-strength/harness.js';
import {
  easyStrategy,
  mediumStrategy,
  randomStrategy,
} from '../../benchmarks/ai-strength/strategies.js';
import { preloadDecomposer } from '@lib/ai/decomposer/index.js';

const SEEDS = Number(process.env.BENCH_SEEDS ?? 60);

function fmt(label: string, r: MatchupResult): string {
  return `${label}: A win-rate ${(r.winRateA * 100).toFixed(1)}% (${r.winsA}/${r.games})`;
}

describe('AI strength ladder (F2)', () => {
  // Medium leans on the Bobgy WASM decomposer for lead plays; preload so the
  // first calls aren't degraded to the heuristic fallback while WASM loads.
  beforeAll(async () => {
    await preloadDecomposer();
  });

  it(`medium beats easy (${SEEDS} seeds × 2 orientations)`, () => {
    const r = runMatchup(mediumStrategy, easyStrategy, SEEDS);
    console.log(fmt('medium vs easy', r));
    expect(r.games).toBeGreaterThan(0);
    expect(r.winRateA).toBeGreaterThan(0.5);
  });

  it('easy beats random', () => {
    const r = runMatchup(easyStrategy, randomStrategy, SEEDS);
    console.log(fmt('easy vs random', r));
    expect(r.winRateA).toBeGreaterThan(0.5);
  });

  it('medium beats random by a wide margin', () => {
    const r = runMatchup(mediumStrategy, randomStrategy, SEEDS);
    console.log(fmt('medium vs random', r));
    expect(r.winRateA).toBeGreaterThan(0.6);
  });
});
