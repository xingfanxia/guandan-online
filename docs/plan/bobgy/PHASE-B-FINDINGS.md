# Bobgy Phase B — empirical findings (2026-05-28)

Phase B's goal (per [`PHASE-A.md`](PHASE-A.md) §10) is a Hard tier that
**decisively** beats Medium, gated by the F2 strength benchmark
(`tests/ai/strength.test.ts`), after which the Hard UI chip ships. This note
records a bounded, empirical attempt and its honest result so the next attempt
starts from evidence, not a blank slate.

## What was tried

The starting point: the pre-Phase-B Hard tier (`lib/ai/hard.ts`) already adds,
vs Medium, **decomposition-aware following** (`bestByRemainingDecomposition`)
and **deny-the-finisher** aggression — yet it benchmarks ≈ Medium (50%). The
diagnosis: Hard's **lead** was identical to Medium's (`chooseMediumMove`), and
the lead is where most of a tier's strength lives (the leader dictates tempo;
the follow policy only matters when someone else leads).

So the lever under test was a **strategically-ordered decomposition lead**: take
the decomposer's optimal min-decomposition (same one Medium uses) and change
only WHICH group is led first. Three principled orderings were implemented and
benchmarked at 120 games (`BENCH_HARD_SEEDS=60`), deterministic seeded
self-play:

| Lead ordering policy | hard vs medium | hard vs random |
|---|---|---|
| Baseline (lead = Medium's `plays[0]`) | 50.0% (60/120) | 89.2% |
| v1 — longest/highest non-bomb first, bombs last | 50.8% (61/120) | 91.7% |
| v2 — shed-low (cheapest first, longer tiebreak) | 50.8% (61/120) | 91.7% |
| v3 — opponent-aware (lead high to retain control when an opponent is ≤5 cards, else shed-low) | 50.8% (61/120) | 91.7% |

## Why it doesn't work

All three orderings produced the **identical** 61/120 — including v1 (highest-
first) and v2 (lowest-first), which are exact opposites. If the lead ORDER
mattered, opposite sorts would diverge. They don't. The reason: the decomposer's
optimal decomposition, once filtered to *enumerable legal leads of the standalone
hand*, almost always presents **one dominant usable lead**, and Medium already
plays it. Reordering a one-element pool is a no-op. Heuristic reordering of the
decomposition cannot differentiate the tiers.

## Conclusion (honest acceptance-gate verdict)

Heuristic lead-policy tweaks **do not** decisively beat Medium — confirmed
empirically across three opposite-direction policies. This matches the original
plan's assessment: a decisive Hard>Medium is **research-grade** work. Per the
project's anti-slop discipline (the F12 honesty gate), the **Hard UI chip stays
withheld** — shipping a 50.8% "difficulty" would be exactly the fake-difficulty
slop the benchmark exists to prevent. The lead-reordering experiment was reverted
(no measurable benefit = dead complexity); Hard remains at the documented
baseline (decomposition-aware follow + deny-the-finisher, lead = Medium).

## What a genuine attempt needs (forward guidance)

Don't repeat the heuristic-reorder dead-end. A decisive Hard needs **opponent-
hand determinization + multi-trick search**:

1. **`handTracker.ts`** (per PHASE-A §10) — reconstruct opponent suit/rank
   cardinality from move history, not just the hand COUNT the benchmark already
   provides. The count alone didn't help (v3); the *distribution* is what a
   lookahead needs to sample.
2. **Determinization** — sample plausible opponent hands consistent with the
   tracked constraints + the unseen card pool.
3. **Multi-trick rollout** — for each candidate lead/follow, play out N tricks
   against sampled opponents (using Medium as the rollout policy) and pick the
   action with the best expected finish position. This is single-determinization
   MCTS / PIMC — the standard approach for imperfect-information trick games.

This is a multi-session effort with its own design phase, and even then may land
near 50% (Guandan lead strategy is genuinely hard). Keep the F2 benchmark as the
honest gate: the chip ships only when `hard vs medium` clears a decisive margin
(suggest ≥ 0.55 sustained at ≥ 200 games), and the gate must run cheaply enough
on CI (mind `BENCH_HARD_SEEDS` — a determinization rollout is far more expensive
per move than the decomposer alone; see the CI timeout fix in commit `11f740c`).
