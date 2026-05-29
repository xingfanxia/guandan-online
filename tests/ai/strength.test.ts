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
  hardStrategy,
  randomStrategy,
} from '../../benchmarks/ai-strength/strategies.js';
import { preloadDecomposer } from '@lib/ai/decomposer/index.js';

const SEEDS = Number(process.env.BENCH_SEEDS ?? 60);

// The Hard matchups decompose per candidate beat (1-ply structural lookahead),
// so a hard-vs-decomposer-opponent game is ~16x the cost of a medium matchup.
// Their bounds are loose honesty gates (≥0.45 / >0.6), not precision estimates,
// so 60 games is an ample sample — keeping them at SEEDS=60 (120 games) would
// burn ~32s on a 2-core CI runner for no statistical gain. The precision-
// sensitive matchups (medium must clear >0.5) stay at the full SEEDS budget.
const HARD_SEEDS = Number(process.env.BENCH_HARD_SEEDS ?? 30);

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

  // F12 HONESTY GATE. The Bobgy Phase-B plan calls a decisive Hard>Medium
  // lookahead "research-grade work" needing its own design phase. The
  // heuristic Hard tier (decomposition-aware following + deny-the-finisher
  // aggression) is decomposer-CLASS — it dominates random like Medium does,
  // but it is NOT yet measurably stronger than Medium (benchmarks ~50%).
  // We assert the TRUE state, not a false "Hard is stronger" claim: Hard is
  // at least Medium-class (not materially weaker) and crushes random. Exposing
  // a "Hard" difficulty chip is deliberately withheld until the lookahead
  // policy actually moves this number — shipping a chip at 50% would be the
  // fake-difficulty AI-slop this very benchmark exists to prevent.
  // Hard decomposes per candidate beat (1-ply structural lookahead), so these
  // matchups are decomposer-heavy. They run at HARD_SEEDS (smaller sample, loose
  // bounds) with a generous timeout that leaves ~3.7x headroom over the observed
  // ~16s cost on a 2-core CI runner.
  it(`hard is at least medium-class (not materially weaker) (${HARD_SEEDS} seeds × 2)`, () => {
    const r = runMatchup(hardStrategy, mediumStrategy, HARD_SEEDS);
    console.log(fmt('hard vs medium', r));
    expect(r.games).toBeGreaterThan(0);
    expect(r.winRateA).toBeGreaterThanOrEqual(0.45);
  }, 60_000);

  it(`hard dominates random by a wide margin (decomposer-class) (${HARD_SEEDS} seeds × 2)`, () => {
    const r = runMatchup(hardStrategy, randomStrategy, HARD_SEEDS);
    console.log(fmt('hard vs random', r));
    expect(r.winRateA).toBeGreaterThan(0.6);
  }, 60_000);
});
