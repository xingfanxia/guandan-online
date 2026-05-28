# Frontier Loop — Findings Surface

Typed gap inventory for predicate **"fully close all gaps"**. Status values:
`OPEN` · `FIXED_PENDING_CONFIRMATION` · `CLOSED` · `BLOCKED_EXTERNAL` (needs deploy / real traffic / DNS — cannot be verified in-loop) · `DEFERRED_V1.1` (explicitly out of v1 per PLAN.md).

Baseline (2026-05-28): `npm test` 1138 passed | 1 skipped · typecheck clean · build 248kB JS.

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
| F2 | evaluator+product | HIGH | OPEN | brief "AI quality matters" | no benchmark proves Medium > Easy > random; tier strength unmeasured (T5 gap) |
| F3 | evaluator | MED | OPEN | `vitest.config.ts:26` | coverage gate is `lib/**` only — `src/**` (React screens/components) ungated → silent UI regressions |
| F4 | evaluator | MED | OPEN | `playwright.config.ts` mobile projects | mobile e2e scoped to orientation specs; modal flows (sign-in/create/tribute) untested at mobile sizing |
| F5 | product | MED | OPEN | EXCHANGE-1 | optional 换牌 rule unimplemented |
| F6 | product | MED | OPEN | SEC-2 | IP throttle + same-room IP warning unimplemented |
| F7 | product | MED | OPEN | SEC-3 | report button + admin dashboard unimplemented |
| F8 | product | LOW | OPEN | SEC-4 | Vercel BotID unimplemented (logic testable; deploy-gated acceptance) |
| F9 | product | MED | OPEN | AI-3 | player assistance (auto-sort/suggest/wildcard) unimplemented |
| F10 | product | MED | OPEN | AI-4 | mid-game DC→bot takeover unimplemented |
| F11 | observability | LOW | OPEN | DEPLOY-2 | latency beacons + p50/p95 unimplemented (traffic-gated acceptance) |
| F12 | product | LOW | OPEN | Bobgy Phase B | Hard tier lookahead + UI chip; materially harder, separate session per `docs/plan/bobgy/PHASE-A.md §10` |

## Working order (leverage × verifiability)

1. F1 race fix — concrete OPEN bug, fully verifiable
2. F2 AI strength benchmark — proves core claim, fully verifiable
3. F3 + F4 false-green zones — closes evaluator gaps
4. F6 SEC-2, F9 AI-3, F5 EXCHANGE-1, F10 AI-4, F7 SEC-3 — pure-logic milestones, TDD-able
5. F8 SEC-4, F11 DEPLOY-2 — logic in-loop, acceptance deploy/traffic-gated
6. F12 Bobgy Phase B — last
