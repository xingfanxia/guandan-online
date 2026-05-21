# Implementation Plan Index

**Status**: Plan phase active (2026-05-16). Research is complete (see [`docs/research/`](../research/)); this directory holds the executable plan derived from the research synthesis.

## Files

| File | Purpose |
|---|---|
| [`PLAN.md`](PLAN.md) | Master execution plan. 6 phases (P0–P5) × ~30 milestones. Each milestone has goal, dependencies, deliverables, acceptance criteria, file paths, effort estimate. |
| [`bobgy/PHASE-A.md`](bobgy/PHASE-A.md) | Bobgy WASM Phase A execution plan (2026-05-21). Vendor source + commit prebuilt .wasm, new `lib/ai/decomposer/` module + thin Medium hook. 10-step checklist for next-session execution. |
| `<phase>/PLAN.md` (future) | Per-phase tactical plan with task-level breakdown. Created when each phase enters execution. |

## High-level structure

```
P0  Foundation         (week 1-2)  Rules engine + transport + auth bridge + hidden-state filter
   ↓
P1  Vertical slice     (week 3-4)  1H + 3 Easy bots play a complete game on landscape phone
   ↓
P2  Room lifecycle     (week 4-5)  Real room create / join / browse / share with custom rules
   ↓
P3  Full ruleset       (week 5-6)  Tribute + A-level + game-end + UI flows for each
   ↓
P4  Multi-player + AI  (week 6-7)  6/8 player layouts + Hard LLM + player assistance + DC takeover
   ↓
P5  Production         (week 7-8)  Anti-cheat baseline + custom domain + latency beacons

Polish (v1.1+)                     Animations / sound / ranked mode / DanLM / PRC mirror
```

Total v1 effort: **~7-8 weeks full-time** for a single engineer. Each phase ends with a working, demoable artifact.

## Phase entry criteria

| Phase | Enters when... |
|---|---|
| P0 | Plan approved. Research complete. |
| P1 | All P0 milestones merged + acceptance tests green. |
| P2 | P1 vertical slice deployable to local dev. |
| P3 | P2 ROOM-1 covers happy path. |
| P4 | P3 full 4P game completes including tribute + A-level. |
| P5 | P4 6/8 player + AI tiers demonstrated. |
| Launch | All P5 milestones merged. Custom domain live. 1 week soak test passed. |

## Milestone naming

Per global convention from `~/.claude/CLAUDE.md`: `<MILESTONE>-N: <description>`. Never stack two letter axes (no "Phase A / Stage B" — milestone IDs are the only ordering primitive).

Mnemonics in use:
- `CORE-N`: rules engine, game state machine
- `NET-N`: realtime transport (SSE+POST + Redis)
- `UI-N`: visual components and screens
- `AUTH-N`: identity, ownership tokens, cross-project bridge
- `ROOM-N`: room lifecycle (create / join / leave / browse)
- `AI-N`: bot engines and player assistance
- `TRIBUTE-N`: tribute phase implementation
- `SEC-N`: anti-cheat baseline
- `DEPLOY-N`: production deployment
- `POLISH-N`: deferred polish work

## Sources

This plan derives from these research streams (see `docs/research/`):

- [`SUMMARY.md`](../research/SUMMARY.md) — top-line synthesis + locked decisions
- [`realtime-sync-deep-dive.md`](../research/realtime-sync-deep-dive.md) — prescriptive transport spec
- [`ai-implementation-plan.md`](../research/ai-implementation-plan.md) — per-tier AI pseudocode
- [`tribute-ux-deep-dive.md`](../research/tribute-ux-deep-dive.md) — tribute rules + UI
- [`cross-project-integration.md`](../research/cross-project-integration.md) — sibling scorer bridge
- [`anti-cheat-deep-dive.md`](../research/anti-cheat-deep-dive.md) — security baseline
- [`china-network-deployment.md`](../research/china-network-deployment.md) — PRC delivery
- [`mobile-landscape-ux.md`](../research/mobile-landscape-ux.md) — CSS rotate + layouts
- [`card-visual-assets.md`](../research/card-visual-assets.md) — Unicode + Geist decision
- [`game-rules.md`](../research/game-rules.md) — complete ruleset
