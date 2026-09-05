# CLAUDE.md

Guidance for Claude Code (and other AI assistants) working on **guandan-online**.

## Project overview

Real online multiplayer Guandan (掼蛋) — landscape-first web game. 4 / 6 / 8 player rooms, AI bots with multiple difficulties, auto-sort hand, custom rules per room, invite links, real-time play.

Companion to sibling `../guandan-scorer` (in-person scoring/tracking app). This project is the actual playable game; the scorer was scoring-only.


## Status references

Read [`docs/agent/current-phase.md`](docs/agent/current-phase.md) when planning
work against the shipped system or checking remaining milestones. Read
[`docs/agent/history.md`](docs/agent/history.md) only when investigating a
regression, prior decision, deployment incident, or historical verification
claim.

## Coding conventions (post-bootstrap)

- **TypeScript strict mode** with `noUncheckedIndexedAccess`. Indexing returns `T | undefined` — use `?? fallback` or `!` (with proof of bounds).
- **Pure functions where the sibling has singletons.** Sibling scorer uses a `state` singleton (`src/core/state.js`); online's multiplayer model demands purity. Caller passes state in, function returns a diff.
- **`// SYNC:` pins** — any file that ports sibling-scorer logic carries a `// SYNC: ../guandan-scorer/<path>:<lines>` comment. If sibling changes, update both within the same PR. Drift here breaks cross-app account/result correctness once AUTH-2 ships.
- **Path aliases**: `@/*` → `src/*`, `@lib/*` → `lib/*`, `@tests/*` → `tests/*`.
- **TDD non-negotiable for `lib/game/*` and `lib/realtime/*`** — failing test first, then minimal impl. Other surfaces (UI, scripts) can write tests alongside.
- **Coverage gate**: per-path via `vitest run --coverage` — `lib/**` at 80% (the game/realtime core; CORE-1 targets 95%+), `src/**` ratchet-gated at 74/65/67/72 (React surfaces; recalibrated after the GameTable UI-integration pass — SSE-bound submit glue is brittle to unit-test). Current suite: **1512 tests** as of 2026-05-28 (1138 → 1512 across the v1-completion loop: all 7 remaining milestones + the F1/F2/F13 hardening fixes). Component tests use `// @vitest-environment jsdom` per-file directive + `tests/setup/jest-dom.ts` setup file.
- **Relative TS imports MUST end in `.js`** (e.g. `from './foo.js'` for `foo.ts`). Vercel's per-function tsc check runs under `nodenext` moduleResolution and rejects extensionless imports with TS2835. Our tsconfig uses `moduleResolution: "bundler"` so Vite/Vitest transparently map `.js` → `.ts` at module-resolution time — both paths work. Path-alias imports (`@/foo`, `@lib/bar`, `@tests/baz`) and package imports stay unchanged. Migration applied 2026-05-21 via `scripts/migrations/add-js-extensions.py` (idempotent — re-run safely after adding new code if you forget the suffix).
- **Single publish gateway**: every server→client event MUST route through `lib/realtime/publish.ts` (the only file allowed to call `EventBus.publish` / `EventLog.append`). `scripts/security/grep-no-leak.sh` enforces this at CI time — it fails the build if any file under `lib/` / `src/` / `api/` (except the gateway + bus/log impls + redisClient type defs + tests) directly invokes `.publish(` / `.append(` / `redis.publish(` / `xadd(`. Run via `npm run security:no-leak`.
- **Per-recipient EventLog keys** (security-critical): each filtered payload is appended to `eventLogKey(roomId, recipient)`, NOT to a single per-room key. A shared per-room log mixing all recipients' filtered payloads would let SSE backlog replay surface another player's `yourHand` view on resume. The live bus channels (`game:<roomId>:player:<id>`) already had this isolation; SEC-2 (commit `75424ee`) closed the matching gap on the durable log path. Anyone reading the log MUST use `eventLogKey(roomId, playerId)` from `lib/realtime/publish.ts`.
- **Event version monotonic per-recipient**: SSE `id:` line uses `event.version` (formatted in `lib/realtime/sse.ts`). For client `Last-Event-ID` resume to work, `event.version` must align with the per-recipient log seq. A single move can emit multiple events (e.g., `move_played` then `trick_won`); each gets a sequential version, and the move handler advances `RoundEnvelope.version` to the LAST emitted event so the next move's `fromVersion` check stays aligned. Adding new event-emitting paths MUST preserve this contract — see `lib/realtime/deriveMoveEvent.ts` + `lib/api/move.ts` for the pattern.
- **Comments**: explain WHY not WHAT. The plan's "no narration / no edit-history" rule applies here too.

## Tooling

- Node `>=22` (Vercel deploys on `nodejs22.x`); local dev tolerates Node 23.x with a benign vitest engine warning.
- `npm test` (vitest), `npm run typecheck`, `npm run build` (tsc -b + vite build), `npm run dev` (vite dev server on :5174).
- Vercel project `panpanmao/guandan-online` linked (projectId `prj_Y3gwNGDixTDz5KBfkjJjsYWcwrlv`, GitHub auto-connected). Upstash Redis provisioned via Marketplace integration. Production deploy live both via GitHub auto-deploy (since 2026-05-21, commit `edeb6c7`) and `vercel deploy --prebuilt --prod` (since 2026-05-19); the `gdo.ax0x.ai` custom domain is still pending DNS (add it via the Vercel dashboard to surface its domain-specific CNAME + `vc-domain-verify=…,dc` TXT — CLI `vercel domains add` is blocked, `domain_not_owned`, because the `ax0x.ai` apex is third-party-managed). **Note:** despite the `all_except_custom_domains` SSO setting, the production `*.vercel.app` aliases (e.g. `guandan-online-henna.vercel.app`) are in practice publicly reachable — AX plays on the henna alias and unauthenticated `POST /api/room/*` + SSE work — so DNS is only about the pretty domain, not basic playability. Local dev: `vercel env pull .env.local` preferred over hand-editing.

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
