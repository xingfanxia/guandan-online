# AI strength benchmark

Headless self-play that proves the difficulty tiers actually differ in playing
strength — the brief's core claim ("AI quality matters; no random-play stubs").
This is the project's T5 metric: prior tests only proved bot moves were *legal*,
never that they were *good*.

## What it measures

`runMatchup(stratA, stratB, seeds)` plays full 4P rounds with one strategy on
each team. Each seeded deal is played in **both** team orientations (A on t1,
then A on t2) to cancel deal-strength and seat-0 leader bias. A "win" = strategy
A's team holds 头游 (the first finisher).

Strategies (`strategies.ts`):
- `easy` / `medium` — wrap the production dispatcher (`lib/ai/dispatch.ts`)
- `random` — uniform legal play (the floor of the ladder)

## Running it

The proof lives in the test suite and runs in CI:

```bash
npx vitest run tests/ai/strength.test.ts
```

Scale up for a tighter estimate (each seed = 2 oriented rounds):

```bash
BENCH_SEEDS=300 npx vitest run tests/ai/strength.test.ts
```

## Observed ladder (60 seeds × 2 orientations = 120 games per matchup)

| Matchup | A win-rate |
|---|---|
| medium vs easy | 62.5% |
| easy vs random | 79.2% |
| medium vs random | 94.2% |

Monotonic: **medium > easy > random**. The test asserts the ordering (with
margin), not the exact figures, so it stays green across engine tweaks while
still catching a tier collapse.

## Known limitation (finding F13)

The move generator and `playCards` can disagree on how to interpret wildcard
(heart-of-level-rank) cards in an ambiguous full house, so a proposed play is
occasionally rejected. The harness falls back to a pass in that case (affects
all strategies equally). Tracked in `docs/reports/frontier-loop/findings.md`.
