# Frontier Loop — Findings Surface

Typed gap inventory for predicate **"fully close all gaps"**. Status values:
`OPEN` · `FIXED_PENDING_CONFIRMATION` · `CLOSED` · `BLOCKED_EXTERNAL` (needs deploy / real traffic / DNS — cannot be verified in-loop) · `DEFERRED_V1.1` (explicitly out of v1 per PLAN.md).

Baseline (2026-05-28): `npm test` 1138 passed | 1 skipped · typecheck clean · build 248kB JS.

**Update (2026-05-29 — production SSE black-screen, F14)**: First-ever real gameplay test on the production deploy (AX reported a black table on start). Root cause: `@upstash/redis` auto-deserializes Redis Stream field values on read, so `eventLog.range` / `eventBus.tick` double-parsed (`JSON.parse` on an already-parsed object) → threw out of the SSE `start` callback → empty stream → no `deal` event → black table. The unit/e2e suites never caught it because they run against memory infra or the vite-api-plugin (or a `_fakeRedis` that returned raw strings) — **never the real Upstash read path**. Fixed in commit `9967a5b` and verified live (deal streams, correct 13-card 8P hand). Two ledger corrections this surfaced: (a) the app is **publicly reachable** on the `*.vercel.app` aliases (henna) — unauthenticated `POST /api/room/*` + SSE work despite the SSO setting — so **F8 (SEC-4 BotID) and F11 (DEPLOY-2 latency) are NOT DNS-blocked**; they can be confirmed against the live henna alias now, DNS is only for the pretty domain. (b) "deployed + CI-green + health-check-200" was treated as `CLOSED`-equivalent for playability when no game had ever been played on prod — the new acceptance bar is a live create+start+stream smoke.

**Update (2026-05-28 — v1 shipped + CI confirmed)**: the loop's 18 commits were local-only until this session; pushed `a96ebd8..b214942` to origin/main, so the test-level confirmation for F1–F13 is now real (CI run `26617951286` green: Typecheck+Unit+Security + Playwright). Production deploy `hr5i5vmuw` ● Ready, `/api/health` 401-SSO in 0.37s (function invokes; not the old timeout). **One CI-only failure surfaced + fixed**: F2's `hard vs medium` benchmark hit the 30s per-test timeout on the 2-core GitHub runner (first time strength.test.ts ran on CI — both players are decomposer-heavy, ~16x a Medium matchup). Fixed in commit `11f740c` by splitting the seed budget — Hard matchups run at `BENCH_HARD_SEEDS` (default 30 = 60 games; loose ≥0.45/>0.6 gates) with a 60s timeout; precision matchups keep `SEEDS=60`. Suite now `npm test` 1512/1512. **Still genuinely gated, NOT closed by this push**: F8 (SEC-4 BotID edge activation needs the BotID SDK + deploy), F11 (DEPLOY-2 latency acceptance needs real traffic) — both remain `FIXED_PENDING_CONFIRMATION` until public access (DNS) lands.

## Reconciliation: PLAN.md milestone status vs code (anchor A)

| Milestone | PLAN status | Code evidence | Verdict |
|---|---|---|---|
| CORE-1/2/3/4, NET-1/2/3, AUTH-1, UI-1..7, ROOM-1/2/3, TRIBUTE-1/2, AI-1, SEC-1 | shipped | files + tests present | DONE |
| AUTH-2 | cancelled 2026-05-19 | n/a | N/A |
| AI-2 (LLM Hard) | superseded | deleted | N/A (→ Bobgy Phase B) |
| EXCHANGE-1 | planned | no `lib/game/exchange.ts`, no `api/exchange/` | **OPEN** |
| SEC-2 (IP throttle) | planned | no `ipThrottle.ts`/`createHandle.ts`/`ipWarning.ts` (the "SEC-2" in CLAUDE.md is a label collision — that commit was the per-recipient EventLog fix) | **OPEN** |
| SEC-3 (report+admin) | planned | no `api/report.ts`/`api/admin/`/`AdminDashboard.tsx` | **OPEN** |
| SEC-4 (BotID) | planned | no `lib/security/botId.ts` | **OPEN** (logic in-loop; full accept needs deploy) |
| AI-3 (assistance) | planned | no `src/lib/assist/`, no assist components | **OPEN** |
| AI-4 (DC takeover) | planned | no `dcDetection.ts`/`botTakeover.ts`/`dcCheck.ts` | **OPEN** |
| DEPLOY-2 (telemetry) | planned | no `telemetry/` | **OPEN** (logic in-loop; full accept needs real traffic) |
| POLISH-1..4, DanLM, DEPLOY-3 | deferred v1.1 | n/a | DEFERRED_V1.1 |
| DNS gdo.ax0x.ai | pending | external | BLOCKED_EXTERNAL (non-code) |

## Findings ledger

| id | axis | severity | status | anchor | evidence |
|---|---|---|---|---|---|
| F1 | product | HIGH | FIXED_PENDING_CONFIRMATION | `tests/api/move.test.ts:1343` it.skip | lastActiveAt read-modify-write race resurrects departed member → fixed via roomStore side-key (touchActivity/getActivity); cron reads max; skipped test unskipped + 6 new tests |
| F2 | evaluator+product | HIGH | FIXED_PENDING_CONFIRMATION | brief "AI quality matters" | `benchmarks/ai-strength/` + `tests/ai/strength.test.ts` prove monotonic ladder over 120 seeded games: medium 62.5% > easy, easy 79.2% > random, medium 94.2% > random |
| F13 | product | HIGH | FIXED_PENDING_CONFIRMATION | discovered by F2 benchmark | `tryFullHouse` 2-rank branch returned the FIRST valid wildcard split instead of the maximal triple rank, so the generator (maximal) and `playCards` (re-analyze) disagreed on ambiguous wildcard full houses → bot turn stalls in prod. Fixed `lib/game/patterns.ts` to pick max triple rank per the "defaults to largest" convention; 2 new tests; benchmark band-aid removed (now runs clean at 400 games/matchup) |
| F3 | evaluator | MED | FIXED_PENDING_CONFIRMATION | `vitest.config.ts:26` | coverage gate now per-path: lib/** held at 80%, src/** ratchet-gated at 75/65/68/73 (just below its 77.6% floor) so it can no longer silently regress. +App.tsx +RotatePrompt tests lifted the floor from 73.6%. Raise toward 80% as GameTable reducer coverage grows |
| F4 | evaluator | MED | FIXED_PENDING_CONFIRMATION | `playwright.config.ts` mobile projects | new `mobile-modals` project (chromium engine, iPhone-landscape viewport+touch) + `tests/e2e/mobile-modals.spec.ts` (4 green) cover sign-in / join / create modals at mobile sizing. NOTE: CI auto-run of this project is a 1-line `ci.yml` change blocked by the workflow-injection security hook — needs manual approval to wire (`--project=chromium-desktop --project=mobile-modals`) |
| F5 | product | MED | FIXED_PENDING_CONFIRMATION | EXCHANGE-1 | 换牌: exchange.ts/exchangeFlow.ts vote→select→swap state machine + 2 commands + 4 events (exchange_completed deal-filtered) + dealNextRound trigger + dispatch + ExchangeVote/SelectModal wired into both tables. Off-by-default room rule. Manual-tribute+exchange interleave deferred (documented edge) |
| F6 | product | MED | FIXED_PENDING_CONFIRMATION | SEC-2 | ipThrottle (5/IP/24h) + ipHash (salted, raw IP never stored) + findSharedIpGroups host-gated in getRoom + createHandle route + HostIPWarning wired into Waiting |
| F7 | product | MED | FIXED_PENDING_CONFIRMATION | SEC-3 | profileStore + reportStore (1/pair/game) + api/report + admin reports/ban/reset (ADMIN_TOKEN fail-closed) + AdminDashboard at #/admin + ReportButton per opponent |
| F8 | product | LOW | FIXED_PENDING_CONFIRMATION | SEC-4 | botId verdict reader + botGate (403/pass, fail-open unknown) wired into create/move/join. Edge activation (BotID SDK + challenge) deploy-gated |
| F9 | product | MED | FIXED_PENDING_CONFIRMATION | AI-3 | assist sort/suggest libs + SortButton/SuggestionHint/WildcardSubDialog/EndgameAssist wired into both tables |
| F10 | product | MED | FIXED_PENDING_CONFIRMATION | AI-4 | dcDetection + botTakeover + reclaim + seenStore (SSE-heartbeat liveness, race-free) + dcCheck cron + PlayerStatusBadge. Cron hydrates lastSeenAt so live players aren't taken over (regression-tested) |
| F11 | observability | LOW | FIXED_PENDING_CONFIRMATION | DEPLOY-2 | latency beacon (wired around /move) + ingest route + nearest-rank p50/p95/p99 per region + AdminDashboard panel. Real-traffic acceptance deploy-gated |
| F14 | product+evaluator | CRITICAL | CLOSED | live prod gameplay (henna alias) | Production game rendered a black table on start (0 cards / no seats). `@upstash/redis automaticDeserialization:true` JSON-parses stream field values on read, so `eventLog.range` + `eventBus.tick` double-parsed (`JSON.parse(object)` → `"[object Object]" is not valid JSON`), throwing out of the SSE `start` callback (empty stream, no `deal` event) and silently dropping every live event. Tests passed because `_fakeRedis.xrange` returned raw strings while real Upstash returns objects. Fix `9967a5b`: `decodeStreamValue` (parse strings / pass objects), per-entry catch in `range`, faithful `_fakeRedis.xrange`, +3 regression tests. **Verified live** — deal streams, correct 13-card 8P hand. Evaluator lesson: CI-green ≠ production-verified; acceptance now requires a live create+start+stream smoke. |
| F12 | product | LOW | FIXED_PENDING_CONFIRMATION (scoped) | Bobgy Phase B | Hard tier scaffolding (decomposition-aware following + deny-the-finisher) + dispatch route + benchmark. BENCHMARK FINDING: heuristic Hard ≈ Medium (~50%), so the Hard UI chip is deliberately withheld (anti-slop) — decisive Hard>Medium is the research-grade lookahead the plan defers. Hard dominates random 89%. **2026-05-28 update**: Phase B lead-policy attempt — a strategically-ordered decomposition lead was implemented + benchmarked across 3 opposite-direction orderings (longest-first, shed-low, opponent-aware), ALL 50.8% (61/120) vs Medium → reordering the decomposition is a confirmed no-op (the filtered decomposition presents one dominant lead Medium already plays). Experiment reverted; decisive Hard needs determinization + multi-trick search (research-grade). Empirical baseline recorded in `docs/plan/bobgy/PHASE-B-FINDINGS.md`. Chip stays withheld. |

## Working order (leverage × verifiability)

1. F1 race fix — concrete OPEN bug, fully verifiable
2. F2 AI strength benchmark — proves core claim, fully verifiable
3. F3 + F4 false-green zones — closes evaluator gaps
4. F6 SEC-2, F9 AI-3, F5 EXCHANGE-1, F10 AI-4, F7 SEC-3 — pure-logic milestones, TDD-able
5. F8 SEC-4, F11 DEPLOY-2 — logic in-loop, acceptance deploy/traffic-gated
6. F12 Bobgy Phase B — last
