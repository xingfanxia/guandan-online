# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working on **guandan-online**.

## Project overview

Real online multiplayer Guandan (掼蛋) — landscape-first web game. 4 / 6 / 8 player rooms, AI bots with multiple difficulties, auto-sort hand, custom rules per room, invite links, real-time play.

Companion to sibling `../guandan-scorer` (in-person scoring/tracking app). This project is the actual playable game; the scorer was scoring-only.

## Current phase

**P0 logic layer + most of P1 logic shipped as of 2026-05-18.** All pure-functional pieces are in `lib/` and tested. Remaining work is infrastructure-bound: Upstash live impls of the realtime interfaces, Vercel API route handlers (compose `lib/` functions), UI components, and AUTH-2 sibling-scorer KV migration (Critical Decision Trigger — needs explicit go-ahead).

See `HANDOFF.md` for the per-commit map and `docs/plan/PLAN.md` for the full 31-milestone roadmap.

The plan has 6 phases (P0 → P5) plus deferred polish. Each phase ends with a working, demoable artifact. See `docs/plan/README.md` for the dependency graph and phase entry criteria.

## Coding conventions (post-bootstrap)

- **TypeScript strict mode** with `noUncheckedIndexedAccess`. Indexing returns `T | undefined` — use `?? fallback` or `!` (with proof of bounds).
- **Pure functions where the sibling has singletons.** Sibling scorer uses a `state` singleton (`src/core/state.js`); online's multiplayer model demands purity. Caller passes state in, function returns a diff.
- **`// SYNC:` pins** — any file that ports sibling-scorer logic carries a `// SYNC: ../guandan-scorer/<path>:<lines>` comment. If sibling changes, update both within the same PR. Drift here breaks cross-app account/result correctness once AUTH-2 ships.
- **Path aliases**: `@/*` → `src/*`, `@lib/*` → `lib/*`, `@tests/*` → `tests/*`.
- **TDD non-negotiable for `lib/game/*` and `lib/realtime/*`** — failing test first, then minimal impl. Other surfaces (UI, scripts) can write tests alongside.
- **Coverage gate**: 80% lines on `lib/**` enforced by `vitest run --coverage`. CORE-1 explicitly targets 95%+. Current suite: 487 tests, ~95% line coverage on `lib/`.
- **Single publish gateway**: every server→client event MUST route through `lib/realtime/publish.ts` (the only file allowed to call `EventBus.publish` / `EventLog.append`). `scripts/security/grep-no-leak.sh` enforces this at CI time — it fails the build if any file under `lib/` / `src/` / `api/` (except the gateway + bus/log impls + tests) directly invokes `.publish(` / `.append(` / `redis.publish(` / `xadd(`. Run via `npm run security:no-leak`.
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

- 2026-05-18 — P0 logic layer + most of P1 logic shipped in one autonomous-grind push (25 commits). 487/487 tests, TS strict clean, grep-no-leak gate green. Modules now in `lib/`: game (10 patterns + state machine + session + tribute + hand sort), realtime (15 events + 6 commands + sse + bus + log + idempotency + filter + publish gateway + card codec + handleMove dispatcher), room (code + lifecycle), ai (full enumerator + Easy bot + timing + names), security (rate limiter). See `HANDOFF.md` for commit-by-commit map.
- 2026-05-17 — P0 kickoff: bootstrap + AUTH-1 + CORE-1 part 1 shipped (3 commits). 111/111 tests, 98.45% statement coverage.
- 2026-05-16 — Initial scaffold (research phase begin)
