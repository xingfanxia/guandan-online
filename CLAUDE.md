# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working on **guandan-online**.

## Project overview

Real online multiplayer Guandan (掼蛋) — landscape-first web game. 4 / 6 / 8 player rooms, AI bots with multiple difficulties, auto-sort hand, custom rules per room, invite links, real-time play.

Companion to sibling `../guandan-scorer` (in-person scoring/tracking app). This project is the actual playable game; the scorer was scoring-only.

## Current phase

**Backend feature-complete as of 2026-05-18.** Three autonomous sessions on 2026-05-18 took the project from "P0 logic shipped, needs infra" to "9 HTTP/SSE routes live, full session lifecycle event-driven, integration test green, security gates passing":

- **NET-1C** — Upstash live impls of `IdempotencyCache` / `EventLog` / `EventBus` (via `RedisLike` contract). `createRealtimeInfra(env)` selects memory or Upstash by env vars.
- **API surface** (9 routes total):
  - `POST   /api/room/create`
  - `GET    /api/room/[code]` — public room view (tokens redacted)
  - `POST   /api/room/[code]/join` — emits `room_joined` event
  - `POST   /api/room/[code]/leave` — emits `room_left` event (no-op when host dissolves room)
  - `POST   /api/room/[code]/start` — host-only game-start (deal + first trick, creates GameSession)
  - `POST   /api/room/[code]/move` — idempotent move dispatch + publishEvent fanout (move_played/passed, trick_won, round_end, game_end)
  - `GET    /api/sse/[roomId]` — Server-Sent Events with 270s rotation
  - `GET    /api/cron/cleanup-rooms` — Bearer-ADMIN_TOKEN cron handler that prunes stale rooms + reconciles ghost index entries
  - `GET    /api/health`
- **Persistence layer**: `lib/storage/{roomStore,roundStore,sessionStore}.ts` — Memory + Upstash impls wired via `RealtimeInfra`. roomStore now maintains a `<prefix>active` set index updated atomically with create/delete; `listCodes()` enumerates active rooms for the cron pass.
- **Event derivation**: `lib/realtime/{buildGameState,deriveMoveEvent,deriveRoundEndEvents,deriveLifecycleEvents,buildLobbyGameState}.ts`. Move handler emits up to 4 events per move (move_played/passed + trick_won + round_end + game_end), each with a sequential version aligned to the per-recipient SSE log seq. Lifecycle events use a shared `RoomState.eventVersion` counter that startGame consumes (`deal.version = room.eventVersion + 1`) so clients can resume across lobby → game with a single Last-Event-ID.
- **Integration test**: `tests/integration/full-game-flow.test.ts` walks create → 3× join (with lifecycle events) → start → SSE-subscribe → play → pass and verifies the full event sequence including lifecycle backlog.

Remaining substantive work: UI-1/UI-2 (landscape mobile gameplay screens); AUTH-2 sibling-scorer KV migration (Critical Decision); AI-2 Medium WASM solver.

See `HANDOFF.md` for the per-commit map and `docs/plan/PLAN.md` for the full 31-milestone roadmap.

The plan has 6 phases (P0 → P5) plus deferred polish. Each phase ends with a working, demoable artifact. See `docs/plan/README.md` for the dependency graph and phase entry criteria.

## Coding conventions (post-bootstrap)

- **TypeScript strict mode** with `noUncheckedIndexedAccess`. Indexing returns `T | undefined` — use `?? fallback` or `!` (with proof of bounds).
- **Pure functions where the sibling has singletons.** Sibling scorer uses a `state` singleton (`src/core/state.js`); online's multiplayer model demands purity. Caller passes state in, function returns a diff.
- **`// SYNC:` pins** — any file that ports sibling-scorer logic carries a `// SYNC: ../guandan-scorer/<path>:<lines>` comment. If sibling changes, update both within the same PR. Drift here breaks cross-app account/result correctness once AUTH-2 ships.
- **Path aliases**: `@/*` → `src/*`, `@lib/*` → `lib/*`, `@tests/*` → `tests/*`.
- **TDD non-negotiable for `lib/game/*` and `lib/realtime/*`** — failing test first, then minimal impl. Other surfaces (UI, scripts) can write tests alongside.
- **Coverage gate**: 80% lines on `lib/**` enforced by `vitest run --coverage`. CORE-1 explicitly targets 95%+. Current suite: **676 tests** as of 2026-05-18 (after the SESSION-1 / LIFECYCLE-1 / CRON-1 backend-completion session).
- **Single publish gateway**: every server→client event MUST route through `lib/realtime/publish.ts` (the only file allowed to call `EventBus.publish` / `EventLog.append`). `scripts/security/grep-no-leak.sh` enforces this at CI time — it fails the build if any file under `lib/` / `src/` / `api/` (except the gateway + bus/log impls + redisClient type defs + tests) directly invokes `.publish(` / `.append(` / `redis.publish(` / `xadd(`. Run via `npm run security:no-leak`.
- **Per-recipient EventLog keys** (security-critical): each filtered payload is appended to `eventLogKey(roomId, recipient)`, NOT to a single per-room key. A shared per-room log mixing all recipients' filtered payloads would let SSE backlog replay surface another player's `yourHand` view on resume. The live bus channels (`game:<roomId>:player:<id>`) already had this isolation; SEC-2 (commit `75424ee`) closed the matching gap on the durable log path. Anyone reading the log MUST use `eventLogKey(roomId, playerId)` from `lib/realtime/publish.ts`.
- **Event version monotonic per-recipient**: SSE `id:` line uses `event.version` (formatted in `lib/realtime/sse.ts`). For client `Last-Event-ID` resume to work, `event.version` must align with the per-recipient log seq. A single move can emit multiple events (e.g., `move_played` then `trick_won`); each gets a sequential version, and the move handler advances `RoundEnvelope.version` to the LAST emitted event so the next move's `fromVersion` check stays aligned. Adding new event-emitting paths MUST preserve this contract — see `lib/realtime/deriveMoveEvent.ts` + `lib/api/move.ts` for the pattern.
- **Comments**: explain WHY not WHAT. The plan's "no narration / no edit-history" rule applies here too.

## Tooling

- Node `>=22` (Vercel deploys on `nodejs22.x`); local dev tolerates Node 23.x with a benign vitest engine warning.
- `npm test` (vitest), `npm run typecheck`, `npm run build` (tsc -b + vite build), `npm run dev` (vite dev server on :5174).
- Vercel project NOT yet created. DEPLOY-1 (P5) creates it. Local dev uses `.env.local` per `.env.example`.

## Domain references

- **Sibling rule engine** — `../guandan-scorer/src/game/` (calculator.js, rules.js) has working A-level / 4-6-8 mode / upgrade logic. Reuse where possible.
- **Existing scorer themes** — sibling has 5 production themes (broadcast / linear / trading / atelier / teatable) with proven visual tokens. May or may not transplant; the game UI has very different needs from a scorer.
- **Research findings** — see `docs/research/README.md` for the index.

## What this app is NOT

- Not a fork or rewrite of guandan-scorer. Scorer continues to exist for in-person scoring.
- Not a single-device pass-and-play game. This is real online multiplayer.
- Not portrait-mode. Landscape only on mobile (forced via CSS + orientation prompt fallback).

## Anti-patterns to avoid

- Premature architecture choices before research completes
- Cloning sibling project's structure wholesale — different problem domain
- Stub AI bots that play randomly — the brief explicitly asks for **different difficulties**, so AI quality matters

## Layout conventions

Follow the global file-organization rules from `~/.claude/CLAUDE.md`:
- Docs → `docs/<topic>/`
- Adhoc scripts → `scripts/<topic>/`
- No flat dumps at repo root

## Last updated

- 2026-05-18 (backend-completion session, 3 more commits) — Backend feature-complete. SESSION-1 (`45222be`) ships sessionStore + round_end/game_end events from the move handler. LIFECYCLE-1 (`95b4ff4`) wires room_joined/room_left fanout with shared RoomState.eventVersion counter — per-recipient SSE log seq now contiguous across lobby → game boundary. CRON-1 (`2b6fb4e`) ships the stale-room cleanup endpoint with active-codes index + Vercel hourly cron. Outstanding: UI-1/UI-2, AUTH-2 (Critical Decision), AI-2 Medium. 629 → 676 tests.
- 2026-05-18 (extension session, 7 more commits) — Backend wire-complete. publishEvent fanout from move handler (API-4 part B), POST `/api/room/[code]/start` (API-6), end-to-end integration test (INT-1), per-recipient EventLog keys closing the SSE backlog leak (SEC-2), GET `/api/room/[code]` public view (API-7), trick_won event derivation with multi-event move versioning (EVT-1). 590 → 629 tests.
- 2026-05-18 (first session, 9 commits) — NET-1C live Upstash impls (idempotency / eventLog / eventBus / realtime-infra factory) + API-1 through API-3 (roomStore + create + join + leave + move handler without publishEvent + SSE handler). 487 → 590 tests.
- 2026-05-18 (kickoff session, 25 commits) — P0 logic layer + most of P1 logic. Modules in `lib/`: game (10 patterns + state machine + session + tribute + hand sort), realtime (15 events + 6 commands + sse + bus + log + idempotency + filter + publish gateway + card codec + handleMove dispatcher), room (code + lifecycle), ai (full enumerator + Easy bot + timing + names), security (rate limiter). 487/487 tests, TS strict clean. See `HANDOFF.md` for commit-by-commit map.
- 2026-05-17 — P0 kickoff: bootstrap + AUTH-1 + CORE-1 part 1 shipped (3 commits). 111/111 tests, 98.45% statement coverage.
- 2026-05-16 — Initial scaffold (research phase begin)
