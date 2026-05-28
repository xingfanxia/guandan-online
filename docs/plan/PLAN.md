# Master Execution Plan — Guandan Online v1

**Created**: 2026-05-16
**Status**: Draft for execution. Derives from 13 research streams. See [`README.md`](README.md) for source links.
**Total scope**: ~30 milestones across 6 phases (P0–P5), ~7-8 weeks full-time for a single engineer.
**Convention**: `<MILESTONE>-N: <description>` per `~/.claude/CLAUDE.md`. Each milestone is a single PR / merge unit.

---

## Goal

Ship a real online multiplayer Guandan game with the following capabilities at v1:

1. Landscape-mobile-first (iPhone Safari + Android Chrome) + desktop dual-render
2. 4-player partner mode, fully featured (rules / tribute / A-level / level-up)
3. 6-player and 8-player layouts (rules engine same; AI tier limited to Easy + Medium)
4. 3 AI difficulty tiers (Easy / Medium / Hard) selectable per bot slot
5. Mix of N humans + (M = mode_size - N) bots in same room, any combo
6. Player assistance: auto-sort (理牌) + suggested move (提示) + wildcard substitution UI
7. Custom rule axes per room (A-level strict / 抗贡 condition / bomb hierarchy / etc.)
8. Anonymous @handle login, shared with sibling `guandan-scorer`
9. Realtime via Vercel SSE+POST + Upstash Redis pub/sub
10. Anti-cheat baseline: rate-limit + IP throttle + report + admin dashboard
11. Production-ready: custom domain, client-side latency beacons, error tracking

**Out of scope for v1**: ranked mode + Elo ladder (POLISH-3), DanLM Master tier (POLISH-4), sound design (POLISH-2), full animation choreography (POLISH-1), PRC Tencent mirror (DEPLOY-3 — conditional).

---

## Success criteria for v1 launch

- 1 human + 3 Easy bots can complete a full 4P game in landscape mobile on iPhone 14 Pro (Safari) and Pixel 7 (Chrome) without errors
- 4 humans can complete a full 4P game with real-time card play, including tribute and A-level final
- 8 humans + 0 bots can complete a full 8P game
- 1 human + 7 bots (mix Easy + Medium) can complete a full 8P game
- Mid-game DC + reconnect within 60s preserves game state
- Mid-game DC > 60s promotes the slot to Medium bot, game continues
- Hidden state never leaks: tested via grep + unit test forbidding `redis.publish(` outside `lib/realtime/payload.ts`
- Move-submit p95 < 200ms from West Coast US (where Vercel POPs are)
- Custom domain serves traffic over HTTPS with valid cert
- ADMIN_TOKEN-gated admin dashboard works for ban / reset / view-report flows

---

## Phase summary

```
P0 (week 1-2)  Foundation
  CORE-1 · CORE-2 · AUTH-1 · ~~AUTH-2~~ (cancelled 2026-05-19) · NET-1 · NET-2 · NET-3
  Acceptance: Two browsers in dev can exchange SSE messages via Redis; rules engine passes 100% of unit tests.

P1 (week 3-4)  Vertical slice
  UI-1 · UI-2 · CORE-3 · AI-1 · ROOM-1
  Acceptance: 1 human + 3 Easy bots complete a 4P game start-to-finish on landscape phone.

P2 (week 4-5)  Room lifecycle + rules customization
  UI-3 · ROOM-2 · ROOM-3
  Acceptance: Create room with custom rules + invite + join + browse + leave end-to-end.

P3 (week 5-6)  Full ruleset
  TRIBUTE-1 · UI-4 · CORE-4 · UI-5
  Acceptance: Full 4P game completes including tribute (进贡 / 还贡 / 抗贡) and A-level final.

P4 (week 6-7)  Multi-player + AI Hard + assistance
  UI-6 · AI-2 · AI-3 · AI-4
  Acceptance: 6P and 8P games playable; Hard tier LLM bot ships behind feature flag; assistance features work.

P5 (week 7-8)  Production
  SEC-1 · SEC-2 · SEC-3 · SEC-4 · DEPLOY-1 · DEPLOY-2
  Acceptance: Custom domain live, anti-cheat baseline deployed, admin dashboard functional.

Polish (v1.1+)
  POLISH-1 (animations) · POLISH-2 (sound) · POLISH-3 (ranked) · POLISH-4 (DanLM) · DEPLOY-3 (PRC mirror, conditional)
```

---

## Dependency graph

```
                  ┌── CORE-1 ──┬── CORE-2 ──┬── CORE-3 ──┬── CORE-4 ──┐
                  │            │            │            │            │
                  │            │            │            └────────────┤
P0 │ AUTH-1   (AUTH-2 cancelled 2026-05-19 — per-app independent Upstash) │
   │                                                                  │
   │ NET-1 ──┴── NET-2 ──── NET-3                                     │
   │          │                                                       │
   │          ├───────────────── (all P1+ depend on NET-1 NET-3)      │
   └──────────┘                                                       │
P1 │           UI-1 ──── UI-2 ──┬── ROOM-1 ──── AI-1                   │
   │                            │                                     │
   │                            └─────────┐                           │
P2 │                           UI-3 ──── ROOM-2 ──── ROOM-3            │
   │                                                                  │
P3 │                                     TRIBUTE-1 ── UI-4 ── UI-5    │
   │                                                                  │
P4 │                                            UI-6 ── AI-2          │
   │                                            AI-3 ── AI-4          │
   │                                                                  │
P5 │           SEC-1 ── SEC-2 ── SEC-3 ── SEC-4 ── DEPLOY-1 ── DEPLOY-2
```

CORE-1 blocks everything. NET-1 / NET-3 block everything that exchanges state with client. ~~AUTH-2 (scorer migration) is the only cross-project work and should land first since it touches the sibling repo.~~ AUTH-2 cancelled 2026-05-19 — guandan-online runs on its own Upstash instance, no shared key space with sibling scorer.

---

## Phase 0 · Foundation (week 1-2)

Goal: ship the rules engine, transport layer, auth bridge, and hidden-state filter. After P0, two browsers can exchange game-state messages over Vercel SSE+POST with Redis pub/sub; rules engine validates moves correctly.

### CORE-1 · Rules engine port

**Goal**: Port `hash-panda/guandan-guide` TypeScript trick / hand-recognition engine into our codebase. Add 4/6/8 mode constants from sibling scorer.

**Depends on**: none.

**Deliverables**:
- `lib/game/cards.ts` — card type definitions, deck construction, shuffle helper
- `lib/game/patterns.ts` — combo recognition (单 / 对 / 三 / 三带二 / 三连 / 钢板 / 连对 / 顺子 / 同花顺 / 炸 4-8 / 天王炸)
- `lib/game/bomb.ts` — bomb hierarchy comparison (`bombPower()`)
- `lib/game/wildcard.ts` — heart-suit current-level wildcard substitution logic
- `lib/game/levels.ts` — A-level state machine + mode-gated demotion (port from `../guandan-scorer/src/game/rules.js`)
- `lib/game/upgrade.ts` — level upgrade calculation (port from `../guandan-scorer/src/game/calculator.js`)
- `lib/game/mode.ts` — 4/6/8 player mode constants (port from `../guandan-scorer/src/core/config.js`)
- `tests/game/cards.test.ts` — deck construction + shuffle determinism (seeded random)
- `tests/game/patterns.test.ts` — every combo type recognized + rejected variants
- `tests/game/bomb.test.ts` — full bomb hierarchy table verified (4 < 5 < 同花顺 < 6 < 7 < 8 < 天王炸)
- `tests/game/wildcard.test.ts` — wildcard substitutes correctly in all combo types

**Acceptance**:
- `pnpm test lib/game` exits 0 with > 95% line coverage
- 100+ test cases covering all combo types per `docs/research/game-rules.md`
- Engine handles all edge cases from `docs/research/game-rules.md` § "Edge cases & ambiguities"

**Files to touch**: new — `lib/game/*`, `tests/game/*`
**Effort**: 5-7 days (rules complexity + comprehensive test coverage)
**Notes**:
- License check first: `hash-panda/guandan-guide` repo has no stated license → if unclear, port semantics not source
- Use `seedrandom` for deterministic shuffle in tests
- All Chinese game terms commented with English glosses

### CORE-2 · Game state machine

**Goal**: Implement game lifecycle as a state machine — deal → bid (skip in v1, no bid in Guandan) → trick → round-end. Tribute and A-level state handled in CORE-4.

**Depends on**: CORE-1.

**Deliverables**:
- `lib/game/state.ts` — `GameState` discriminated union (waiting / dealing / playing / round-end)
- `lib/game/turn.ts` — turn order management (north → east → south → west, or 6P / 8P equivalents)
- `lib/game/trick.ts` — trick orchestration (current leader, pass tracking, when trick completes)
- `lib/game/deal.ts` — shuffle + deal cards (108 total, 27 each in 4P, 18 in 6P, 13 in 8P)
- `lib/game/move.ts` — `applyMove(state, move)` pure function returning new state or validation error
- `tests/game/state.test.ts` — state transitions tested
- `tests/game/move.test.ts` — `applyMove` rejects illegal moves with specific error codes

**Acceptance**:
- A scripted game (sequence of moves) can drive `GameState` from `waiting` to `round-end` and produce correct level deltas
- All illegal moves are rejected with named error codes (e.g., `ERR_WRONG_TURN`, `ERR_INVALID_COMBO`, `ERR_DOESNT_BEAT_PREVIOUS`)

**Files to touch**: new — `lib/game/state.ts` + `turn.ts` + `trick.ts` + `deal.ts` + `move.ts`, `tests/game/*`
**Effort**: 4-5 days
**Notes**:
- `applyMove` MUST be pure — no IO, no mutations, returns new state
- Hidden state separation: `GameState` is server-internal; clients receive `PlayerView` (per AI plan §2). Define `PlayerView` here, generate via `lib/realtime/payload.ts` (NET-3)

### AUTH-1 · Copy validateOwnershipToken

**Goal**: Bring sibling scorer's ownership-token auth into this project verbatim, ready to validate tokens issued by scorer.

**Depends on**: none.

**Deliverables**:
- `lib/auth/ownershipToken.ts` — 10-line `validateOwnershipToken(handle, token, kvClient)` function copied from `../guandan-scorer/api/players/_utils.js` lines 259-277
- `lib/auth/handle.ts` — handle normalization (lowercase, strip @, validate format)
- `tests/auth/ownershipToken.test.ts` — valid + invalid + expired token cases
- `lib/auth/README.md` — explains the shared @handle namespace pattern per `docs/research/cross-project-integration.md`

**Acceptance**:
- Function signature matches scorer's exactly
- Tests pass with mocked KV
- Doc comments link to sibling source line numbers for future sync

**Files to touch**: new — `lib/auth/*`, `tests/auth/*`
**Effort**: 0.5 days
**Notes**:
- Do NOT modify the function logic — copy verbatim
- If scorer's signature changes, update here in sync (track via a `// SYNC: ../guandan-scorer/api/players/_utils.js:259-277` comment)

### ~~AUTH-2 · Migrate scorer's player keys to gs: prefix~~ — **CANCELLED 2026-05-19**

**Status**: CANCELLED. The Vercel Marketplace integration auto-provisioned an independent Upstash for guandan-online (separate from sibling scorer's Redis). The two projects no longer share a key space, so the rename from bare `player:{handle}` → `gs:player:{handle}` is moot — there's no shared namespace to keep clean. Sibling scorer's keys stay as-is.

Rationale: hobby-scale project doesn't need cross-app identity continuity; independent Redis means gdo failures don't cascade to scorer. See `docs/research/SUMMARY.md` decision #16 and `docs/research/cross-project-integration.md` (marked SUPERSEDED) for the full reasoning.

### NET-1 · SSE+POST + Upstash Redis transport scaffold

**Goal**: Implement the realtime transport layer per `docs/research/realtime-sync-deep-dive.md` § 7. POST endpoint for client commands, SSE endpoint for server events, Redis pub/sub for room fanout.

**Depends on**: none (parallel with CORE-1).

**Deliverables**:
- `api/sse/[roomId].ts` — SSE GET endpoint, holds connection open up to 270s, subscribes to per-player Redis channel
- `api/move.ts` — POST endpoint accepts `MoveCommand`, validates, persists to game state, publishes to Redis
- `lib/realtime/messages.ts` — `MessageType` enum + `ServerEvent` discriminated union per realtime-sync-deep-dive.md § 7
  - 16 event types: `room_joined`, `move_played`, `tribute_pending`, `tribute_completed`, `tribute_resolved`, `anti_tribute`, `return_required`, `round_end`, `game_end`, `state_resync`, `player_dc`, `player_reconnect`, `bot_takeover`, `chat_message`, `heartbeat`, `error`
- `lib/realtime/upstash.ts` — typed Redis client wrapper, pub/sub helpers
- `lib/realtime/sse.ts` — SSE serialization (`id:`, `event:`, `data:`, `retry:` per spec)
- `tests/realtime/messages.test.ts` — `MessageType` enum exhaustive (typescript `never` check works)

**Acceptance**:
- `curl -N <sse-url>` holds connection 270s, receives heartbeats every 20s
- `curl -X POST <move-url>` accepts JSON `MoveCommand`, returns 200 or 4xx with named error
- Manual test: open two browser tabs to different `<roomId>` — message from tab A POST appears in tab B SSE within 200ms

**Files to touch**: new — `api/sse/[roomId].ts`, `api/move.ts`, `lib/realtime/*`, `tests/realtime/*`
**Effort**: 3-4 days
**Notes**:
- Use Vercel Fluid Compute (300s timeout) — confirmed enabled by default for new projects
- SSE keepalive: comment line `: heartbeat\n\n` every 20s (also serves as GFW idle-timeout mitigation per china-network-deployment.md)
- Per-recipient Redis channel pattern (`game:{roomId}:player:{playerId}`) rather than per-room — move filter work to publisher

### NET-2 · Idempotency keys + Last-Event-ID resume + SSE rotation

**Goal**: Make the transport layer robust to retries, reconnects, and Vercel's 300s SSE limit.

**Depends on**: NET-1.

**Deliverables**:
- `lib/realtime/idempotency.ts` — Upstash `SETNX` with `PENDING` sentinel pattern per realtime-sync-deep-dive.md
- `api/move.ts` enhanced to check `moveId` (client-generated UUID) against KV before processing; replay returns cached response
- `lib/realtime/eventLog.ts` — Upstash Redis Streams (`XADD` per published event with auto-incremented ID); `XRANGE` for replay
- `api/sse/[roomId].ts` enhanced to:
  - Read `Last-Event-ID` header on connect → call `XRANGE eventLog (lastId +` to replay missed events
  - Send `id:` field per event per SSE spec
  - At 270s wall-clock, send `retry: 100\n\n` + close (client EventSource auto-reconnects in ~100ms)
- Client-side `lib/client/realtime.ts` — `EventSource` wrapper that tracks last-received `id`, handles reconnect with `Last-Event-ID` header
- `tests/realtime/idempotency.test.ts` — duplicate POST returns same response, doesn't double-apply
- `tests/realtime/resume.test.ts` — SSE reconnect with `Last-Event-ID` replays correctly

**Acceptance**:
- Replay scenario: POST `/move` twice with same `moveId` → state advances only once, both return same response
- Reconnect scenario: client SSE drops mid-game, reconnects with `Last-Event-ID` → server replays missed events, client resumes
- Rotation scenario: SSE connection at 270s receives `retry: 100` + closes, client reconnects within ~100ms with no perceptible gap

**Files to touch**: enhance — `api/sse/[roomId].ts`, `api/move.ts`; new — `lib/realtime/idempotency.ts`, `eventLog.ts`, `lib/client/realtime.ts`
**Effort**: 2-3 days
**Notes**:
- Idempotency key TTL: 5 minutes (long enough for retries, short enough not to flood KV)
- Redis Stream max length: 1000 events per room (auto-trim with `XADD ... MAXLEN ~ 1000`)
- ~100ms reconnect gap is hidden by UI animation tweens — verified in realtime-sync-deep-dive.md

### NET-3 · Hidden-state filter (buildClientPayload + grep test) — SECURITY-CRITICAL

**Goal**: Centralize all outgoing-to-client state construction in a single function that filters private hand data per recipient. This is the most security-critical code in the codebase.

**Depends on**: CORE-2 (needs `GameState` + `PlayerView` types), NET-1 (needs `MessageType` enum).

**Deliverables**:
- `lib/realtime/payload.ts` — single exported function:
  ```ts
  export function buildClientPayload(
    playerId: PlayerId,
    event: ServerEvent,
    fullState: GameState,
  ): ClientPayload { ... }
  ```
  - Exhaustive `switch` on `event.type` with TypeScript `never` exhaustiveness check
  - For each event type: extracts public fields + only the recipient's private fields (their hand, their tribute prompt, etc.)
- `tests/realtime/payload.test.ts` — every `MessageType` has a test case verifying:
  - Public fields are included
  - Other players' hands are NEVER included
  - The recipient's own hand IS included when relevant
- `scripts/security/grep-no-leak.sh` — CI script that asserts NO file outside `lib/realtime/payload.ts` calls `redis.publish(` or `client.send(`:
  ```bash
  ! grep -rE 'redis\.publish\(|client\.send\(' src lib api \
    --exclude-dir=node_modules --include='*.ts' \
    | grep -v 'lib/realtime/payload.ts'
  ```
  - Exits non-zero on violation
- `.github/workflows/security.yml` — runs grep-no-leak on every PR
- `lib/realtime/upstash.ts` enhanced to NOT export a generic `publish()` — only export `publishToPlayer(playerId, payload)` which calls `buildClientPayload` first

**Acceptance**:
- All `MessageType` variants tested for hidden-state correctness
- `scripts/security/grep-no-leak.sh` exits 0 on clean tree
- Try to add a line `await redis.publish(channel, JSON.stringify(state))` in some other file → CI fails

**Files to touch**: new — `lib/realtime/payload.ts`, `tests/realtime/payload.test.ts`, `scripts/security/grep-no-leak.sh`, `.github/workflows/security.yml`
**Effort**: 2-3 days
**Notes**:
- Treat this as a non-negotiable PR-review item
- Code review checklist for ANY new event type: add to `MessageType` enum → add to `buildClientPayload` switch → add test → green CI
- This is the discipline that replaces Colyseus's `@view` decorator

---

## Phase 1 · Vertical slice (week 3-4)

Goal: 1 human + 3 Easy bots play a complete 4-player game on landscape mobile. End-to-end, no tribute / A-level yet (those land in P3).

### UI-1 · Card primitive + hand + trick + design tokens

**Goal**: Build reusable React components for cards, hand display, trick area. Based on `demos/index.html` and `demos/shared.css`.

**Depends on**: none (frontend can start parallel with P0 backend).

**Deliverables**:
- `src/components/Card.tsx` — single playing card primitive (28px / 40px / 56px size variants)
- `src/components/Hand.tsx` — overlapping row of cards, supports lifted state
- `src/components/Trick.tsx` — center area showing last played combo + metadata
- `src/components/Avatar.tsx` — player avatar with active-state pulse
- `src/styles/tokens.css` — port from `demos/tokens.css`
- `src/styles/components.css` — port from `demos/shared.css`
- `src/stories/Card.stories.tsx` — Storybook (optional but recommended)

**Acceptance**:
- All visual variants from `demos/index.html` render correctly in Vite dev
- 27 cards fit in landscape 800px width without overflow
- Lifted state visible at 28px
- Heart wildcard card shows gold edge + ★ badge

**Files to touch**: new — `src/components/*`, `src/styles/*`
**Effort**: 2-3 days
**Notes**:
- Use Unicode suits (♥♦♣♠) + Geist 700 + `tabular-nums` per `docs/research/card-visual-assets.md`
- `letter-spacing: -0.03em` scoped to `.card__rank` for "10" alignment
- No external SVG dependencies

### UI-2 · 4-player table layout + CSS rotate orientation

**Goal**: Build the 4P landscape table. Implement CSS rotate Majsoul-style orientation handling for iOS.

**Depends on**: UI-1.

**Deliverables**:
- `src/screens/GameTable4P.tsx` — wireframe screen #03 from `demos/index.html` made dynamic
- `src/components/OrientationLock.tsx` — hooks: detect orientation, apply CSS rotate when needed, set `--logical-w` / `--logical-h` CSS vars
- `src/lib/orientation.ts` — `useOrientation()` hook returning `{ effective: 'landscape' | 'portrait-rotated' | 'portrait-prompt' }`
- `src/screens/RotatePrompt.tsx` — fallback overlay (rare path)
- E2E test: `tests/e2e/orientation.spec.ts` — Playwright tests in mobile landscape + portrait viewports

**Acceptance**:
- iPhone 14 Pro landscape (Safari): native landscape, no rotation
- iPhone 14 Pro portrait (Safari): CSS rotate applied, game displays landscape on portrait phone
- Pixel 7 landscape (Chrome): native landscape with `screen.orientation.lock('landscape')` after fullscreen
- Pixel 7 portrait (Chrome): if lock fails, CSS rotate; if rotate breaks, prompt
- Dev `npm run dev` + open on real device shows all 4 paths working

**Files to touch**: new — `src/screens/GameTable4P.tsx`, `src/components/OrientationLock.tsx`, `RotatePrompt.tsx`, `src/lib/orientation.ts`, `tests/e2e/orientation.spec.ts`
**Effort**: 4-5 days (orientation is fiddly — buffer for cross-device testing)
**Notes**:
- Touch event coordinates pass through CSS transform correctly in 2026 browsers (verified in mobile-landscape-ux.md update)
- Test matrix: iPhone SE / iPhone 14 Pro / iPad / Pixel 7 / Galaxy S22
- Virtual keyboard: temporarily exit rotate when text input focused, re-enter on blur

### CORE-3 · Game-end logic + 4P upgrade rules

**Goal**: Implement round-end + game-end state transitions for 4P mode. Level upgrade per double-down / 1+3 / 1+4 rules.

**Depends on**: CORE-2.

**Deliverables**:
- `lib/game/roundEnd.ts` — compute winners + losers + level delta per 4P rules
- `lib/game/gameEnd.ts` — detect game-end condition (team reaches A and wins per current mode rules — strict vs lenient for v1)
- `tests/game/roundEnd.test.ts` — all 4P upgrade scenarios (双下 +3, 1+3 +2, 1+4 +1)
- `tests/game/gameEnd.test.ts` — strict A-mode requires own-A win

**Acceptance**:
- Scripted game completes through 5+ rounds with correct level progression
- Game-end test passes for strict A-mode (must win own A round)
- 6P / 8P upgrade rules deferred to CORE-4 (point thresholds, not 4P table)

**Files to touch**: new — `lib/game/roundEnd.ts`, `gameEnd.ts`, `tests/game/*`
**Effort**: 2-3 days
**Notes**:
- 6/8-player mode rules are different (point thresholds, no A-fail counter per memory `project_rules_change_2026-05.md`); land in CORE-4
- Sweep bonus (8P 1-2-3-4 from same team = +4 levels) tested in CORE-4

### AI-1 · Easy + Medium bots inline — **SHIPPED 2026-05-21**

**Status**: Easy + Medium tiers live. Bobgy WASM decomposer integrated into Medium as Phase A (commit `8a41c83`, 2026-05-21) at `lib/ai/decomposer/` — see `docs/plan/bobgy/PHASE-A.md` for the design contract and HANDOFF.md for delivery notes. Actual file layout differs from this section's "Deliverables" list — see HANDOFF.md for the authoritative module map (`lib/ai/{easy,coop,medium,dispatch,enumerate,runBots,timing,names}.ts` + `lib/ai/decomposer/`). Phase B (lookahead policy + Hard tier revival via deeper Bobgy search depth) is queued — see `docs/plan/bobgy/PHASE-A.md` §10 and the legacy "AI-2 · Hard tier LLM bot" entry below (LLM Hard tier deleted 2026-05-19 in favor of WASM Hard).

**Goal**: Implement Easy + Medium AI tiers per `ai-implementation-plan.md` §1. Bots are first-class room participants with their own `PlayerView`.

**Depends on**: CORE-2, NET-3.

**Deliverables**:
- `lib/ai/engine.ts` — shared rule-based + WASM solver wrapper
- `lib/ai/bots/easy.ts` — Easy tier: legal-move enumeration + 30% noise injection
- `lib/ai/bots/medium.ts` — Medium tier: rule-based + WASM `rounds-to-empty-hand` + partner-aware
- `lib/ai/wasm/` — Bobgy WASM solver binding (compile from `Bobgy/poker-guandan-strategy` C++ source)
- `lib/ai/coop.ts` — partner cooperation decision (`decidePartnerCoop`)
- `lib/ai/timing.ts` — Beta-distributed bot move delay (800-5500ms) + anti-tell jitter
- `lib/ai/names.ts` — Chinese-friendly bot name generator (@小李 / @豆豆 / @毛毛 / etc.) with tier badge
- `api/move.ts` enhanced — after applying human move, while next-turn-is-bot: compute bot move inline, publish, repeat (10s budget; overflow to tick handler)
- `api/tick.ts` — overflow handler for long bot chains (cron via Vercel scheduled function, every 5s)
- `tests/ai/easy.test.ts`, `tests/ai/medium.test.ts` — bots make legal moves only
- `tests/integration/bot-game.test.ts` — 1 human + 3 Easy bots complete a scripted game

**Acceptance**:
- 1 human + 3 Easy bots completes a 4P game (no tribute) in dev
- Bot moves are legal 100% of time across 100-game self-play
- Bot move latency: Easy < 50ms (inline), Medium < 200ms (inline w/ WASM call)
- Partner-aware test: when partner leads, Medium bot defers (passes with low-card) at least 60% of the time

**Files to touch**: new — `lib/ai/*`, `api/tick.ts`, enhance `api/move.ts`
**Effort**: 7-10 days (AI is the longest single milestone)
**Notes**:
- WASM compile: use Emscripten 3.1.50+, output to `lib/ai/wasm/solver.wasm` (~200 KB)
- Bot timing matters for realism — don't make bots play instantly even when they can
- Hard tier (LLM) lands in AI-2, post P3

### ROOM-1 · Room create / join / leave (minimal)

**Goal**: Bring room lifecycle online — create with 6-char code, join by code, leave. Cleanup on host disconnect.

**Depends on**: NET-1, AUTH-1, CORE-2.

**Deliverables**:
- `api/room/create.ts` — POST creates room with 6-char alphanumeric code, returns code + host token
- `api/room/[code]/join.ts` — POST joins room with @handle + token, returns SSE reconnection token
- `api/room/[code]/leave.ts` — POST leaves room, server reassigns/bots takes over slot
- `lib/room/code.ts` — code generator (6-char alphanumeric, KV collision check)
- `lib/room/lifecycle.ts` — room cleanup (delete from KV after 1h idle, immediate delete on host-quit)
- `tests/room/create.test.ts`, `tests/room/join.test.ts` — happy + error paths

**Acceptance**:
- Create room → code in response → join with code from another tab → both see same room state in SSE
- Leave → other players see `player_dc` event
- Code collision: `KV SETNX` retries up to 5 times before erroring

**Files to touch**: new — `api/room/*`, `lib/room/*`, `tests/room/*`
**Effort**: 2-3 days
**Notes**:
- Code format: 3 letters + 3 digits in alternating pattern, ambiguity-safe alphabet (no 0/O, 1/I, Z/2)
- Host token has admin rights (start game, kick, change rules) — separate from join token

### P1 Acceptance gate

After all P1 milestones merge, the following demo must work end-to-end:

1. Open `https://localhost:5173` in iPhone 14 Pro Safari (or equivalent)
2. Sign in with `@阿祥` handle (from sibling scorer)
3. Create a new 4-player room with default rules
4. Choose "Fill with 3 Easy bots"
5. Game starts immediately
6. Play through to round-end (level upgrade visible)
7. No console errors, no SSE disconnects, no stuck states

If this works, P1 is done.

---

## Phase 2 · Room lifecycle + rule customization (week 4-5)

Goal: real room ecosystem — create with custom rules, browse, share via link, configurable AI fills.

### UI-3 · Landing + room create + lobby + room browser

**Goal**: Build screens #01, #02, #10 from `demos/index.html` as functional UI.

**Depends on**: ROOM-1, UI-1.

**Deliverables**:
- `src/screens/Landing.tsx` — 3 CTAs + active room list
- `src/screens/CreateRoom.tsx` — segmented mode picker + AI fill config + rules toggle + code preview
- `src/screens/RoomBrowser.tsx` — filterable list of public rooms with join-as-spectator option
- `src/screens/Waiting.tsx` — pre-game lobby with slot status + 30s AI countdown
- `src/lib/api/rooms.ts` — typed client for room API
- E2E tests: `tests/e2e/lobby-flow.spec.ts`

**Acceptance**:
- Full flow: landing → create → wait for players (or AI countdown) → game starts
- Browse opens public room list, filter by mode, click to join

**Files to touch**: new — `src/screens/Landing.tsx`, `CreateRoom.tsx`, `RoomBrowser.tsx`, `Waiting.tsx`, `src/lib/api/rooms.ts`, `tests/e2e/*`
**Effort**: 3-4 days

### ROOM-2 · Custom rule axes per room

**Goal**: Surface room-creation rule axes per `tribute-ux-deep-dive.md` and `game-rules.md`. Validate at server-side.

**Depends on**: ROOM-1.

**Deliverables**:
- `lib/room/rules.ts` — `RoomRules` type + defaults + validators (per axis)
- Rule axes (each toggleable per room at create time):
  - `aLevelStrict`: boolean (default true)
  - `wildcardHeart`: boolean (default true) — disable for "no wildcard" variants
  - `lastCallDeclare` (报警): boolean (default false)
  - `steelPlate` (钢板 — triple run): boolean (default true)
  - `triPair` (三连对): boolean (default true)
  - `straightFlushAboveBomb5`: boolean (default true)
  - `antiTributeMode`: enum `'two-red-jokers' | 'two-jokers-any' | 'off'` (default `'two-red-jokers'`)
  - `tributeCardSelect`: enum `'auto' | 'player-pick'` (default `'auto'`)
  - `returnTributeMax`: enum `'10' | 'J' | 'unlimited'` (default `'10'`)
  - `returnTributeTimeout`: enum `'10s' | '15s' | '30s'` (default `'15s'`)
  - `tributeDirection6p`: enum (canonical / variant A / variant B)
  - `tributeDirection8p`: enum (canonical / variant A / variant B)
  - `eightPlayerHandSize`: enum `'13' | '14' | '13-leader-keeps-extra'` (default `'13'`)
- `api/room/create.ts` validates rules + persists to room state
- `lib/game/rules-applied.ts` — hooks that read `RoomRules` and apply (e.g., wildcard substitution gated on `wildcardHeart`)

**Acceptance**:
- Create room with non-default rules → game plays with those rules applied
- Test: create with `wildcardHeart: false` → wildcard substitution is disabled mid-game
- Test: create with `aLevelStrict: false` → game-end fires on any A win

**Files to touch**: new — `lib/room/rules.ts`, `lib/game/rules-applied.ts`; enhance `api/room/create.ts`, `lib/game/*` (multiple files reading rules)
**Effort**: 2-3 days

### ROOM-3 · Room sharing (invite link + browse)

**Goal**: Share room via link (web share API), browse public rooms.

**Depends on**: ROOM-1, UI-3.

**Deliverables**:
- `api/room/list.ts` — GET public rooms with filter params (mode, status)
- `src/components/ShareInvite.tsx` — `navigator.share` if supported, else copy link
- `lib/room/access.ts` — room visibility enum (`public | unlisted | invite-only`)
- Frontend: `/r/[code]` route auto-fills code into join flow
- E2E test: share link → open in another browser → auto-join

**Acceptance**:
- Click share → web share dialog OR clipboard copy
- Paste link in fresh browser → lands on join screen with code pre-filled

**Files to touch**: new — `api/room/list.ts`, `src/components/ShareInvite.tsx`, `lib/room/access.ts`, `src/pages/r/[code].tsx`
**Effort**: 1-2 days

---

## Phase 3 · Full ruleset (week 5-6)

Goal: implement tribute (进贡 / 还贡 / 抗贡) + A-level state machine + game-end choreography. After P3, a full game from start to championship plays correctly.

### TRIBUTE-1 · Tribute phase implementation

**Goal**: Implement tribute server-side per `docs/research/tribute-ux-deep-dive.md`. Direction calc, card auto-pick, 还贡, 抗贡, timeouts. **Includes 2-teams-of-N sweep multi-pair tribute** (6P 3-pair, 8P 4-pair) per tribute-ux-deep-dive.md § Update 2026-05-17.

**Depends on**: CORE-3, NET-3, ROOM-2.

**Deliverables**:
- `lib/game/tribute.ts` — direction calculator for 4/6/8 modes (Path A normal + Path B sweep), card-picking logic, anti-tribute detection
- `api/tribute/select.ts` — POST handler for `player-pick` mode (tribute or return)
- `lib/game/state.ts` enhanced — `'tribute-pending' | 'return-pending'` state nodes
- `lib/realtime/messages.ts` extended — 6 new event types per tribute-ux-deep-dive.md (TributeRequiredEvent / ReturnRequiredEvent / TributeCompletedEvent / TributeResolvedEvent / AntiTributeEvent / tribute_return command)
- `tests/game/tribute.test.ts` — all 4P / 6P / 8P direction scenarios + 抗贡 + timeout fallback + 6P/8P sweep multi-pair

**Acceptance**:
- Scripted 4P game: 双下 result → both 3rd + 4th tribute biggest cards → winners 还贡 ≤10
- 抗贡 condition: 4th holds 2 大王 → tribute skipped, banner event published
- Timeout: loser doesn't pick in 15s → server auto-picks biggest card, game continues
- All 4P + 6P canonical + 8P canonical directions tested
- 8P 2-teams-of-4 sweep: 4 simultaneous tribute pairings resolve in parallel, 还贡 follows after

**Files to touch**: new — `lib/game/tribute.ts`, `api/tribute/select.ts`, `tests/game/tribute.test.ts`; enhance — `lib/game/state.ts`, `lib/realtime/messages.ts`
**Effort**: 5-7 days (was 4-5; added day for sweep multi-pair logic)
**Notes**:
- Tribute is the gnarliest game-rule complexity — budget extra time for edge cases
- 6/8 mode direction variants are room-configurable (per ROOM-2's `tributeDirection6p` / `tributeDirection8p`)
- Sweep tribute only triggers in 2-teams-of-N modes (not 4-teams-of-2)

### EXCHANGE-1 · Card exchange optional rule — **SHIPPED 2026-05-28** (backend + UI; manual-tribute interleave deferred)

**Goal**: Implement the optional 换牌 (card-exchange) mechanic — losing team votes after round-end; if >50% pass, all players exchange 3 cards in random direction after tribute.

**Depends on**: TRIBUTE-1, ROOM-2.

**Deliverables**:
- `lib/game/exchange.ts` — vote tally, direction randomization (CW/CCW uniform), card swap orchestration
- `api/exchange/vote.ts` — POST handler for vote casts; aggregates, deadline timer
- `api/exchange/select.ts` — POST handler for 3-card selection per player
- `lib/game/state.ts` enhanced — `'exchange-vote-pending' | 'exchange-select-pending'` state nodes
- `lib/realtime/messages.ts` extended — 6 new event types (ExchangeVoteRequiredEvent, ExchangeVoteCastCommand, ExchangeVoteResolvedEvent, ExchangeSelectRequiredEvent, ExchangeSelectCommand, ExchangeCompletedEvent)
- `tests/game/exchange.test.ts` — vote tally edge cases (tie / unanimous / timeout), CW + CCW direction tested, hand size preservation
- `src/screens/ExchangeVoteModal.tsx` — wireframe S22
- `src/screens/ExchangeSelectModal.tsx` — wireframe S23 (3-card picker + direction diagram)

**Acceptance**:
- Vote opens 15s; if >50% losers vote YES, exchange triggers
- Direction picked server-side, displayed identically to all clients
- All players (incl. winners) must select 3 cards within 15s; timeout = server auto-picks lowest 3
- Hand count preserved post-exchange (each loses 3, gains 3 from neighbor)
- Hidden-state filter: each player's 3 outgoing cards remain private until ExchangeCompletedEvent

**Files to touch**: new — `lib/game/exchange.ts`, `api/exchange/*.ts`, `src/screens/ExchangeVoteModal.tsx`, `src/screens/ExchangeSelectModal.tsx`, `tests/game/exchange.test.ts`; enhance — `lib/game/state.ts`, `lib/realtime/messages.ts`
**Effort**: 3-4 days
**Notes**:
- Rule is OFF by default — only triggers if room creator sets `cardExchange: true`
- Voting scope: ONLY losing-team players (winners auto-accept)
- Direction is server-RNG, no player influence — keeps it fair
- Adds 4 new room rule axes to ROOM-2: `cardExchange`, `exchangeVoteThreshold`, `exchangeVoteDuration`, `exchangeCardCount`

### UI-4 · Tribute phase UI

**Goal**: Build modal-style tribute UI per wireframe #04 + the 抗贡 / 还贡 variants.

**Depends on**: TRIBUTE-1, UI-2.

**Deliverables**:
- `src/screens/TributeModal.tsx` — fullscreen overlay with 3 states: `pending` / `anti-tribute-banner` / `return-pending`
- `src/components/TributeAnimation.tsx` — card travel animation (loser hand → trick → winner hand)
- `src/lib/animation/cardTravel.ts` — reusable card travel motion (CSS transform-based, 400-600ms)
- Tribute card selection UI (for `player-pick` mode): tap-to-select among same-rank cards
- E2E test: complete game with tribute, verify modal appears and animation plays

**Acceptance**:
- After 4P round with `1+4` result, tribute modal appears with correct loser → winner direction
- Card travel animation smooth at 60fps on iPhone 14 Pro
- 抗贡 case: banner appears, no tribute UI, game resumes after 2s
- 还贡 phase: winner sees their hand + tributed card, picks return, animation plays back

**Files to touch**: new — `src/screens/TributeModal.tsx`, `src/components/TributeAnimation.tsx`, `src/lib/animation/cardTravel.ts`
**Effort**: 3-4 days

### CORE-4 · 6/8 player mode rules + A-level full machine

**Goal**: Extend rules engine to 6P and 8P modes (point-based thresholds, no 4P table). Polish A-level state machine (strict/lenient, fail counter for 4P only).

**Depends on**: CORE-3.

**Deliverables**:
- `lib/game/upgrade-6p.ts` — point-based 6P upgrade calc
- `lib/game/upgrade-8p.ts` — point-based 8P upgrade calc + sweep bonus (1-2-3-4 same team = +4)
- `lib/game/aLevel.ts` — A-level state machine refined (strict mode + 4P A-fail counter only)
- `lib/game/turn-order-multi.ts` — turn order for 6P / 8P
- `tests/game/upgrade-6p.test.ts`, `upgrade-8p.test.ts`, `aLevel.test.ts`

**Acceptance**:
- 8P scripted game: 1-2-3-4 from team A → team A levels up by 4 (sweep bonus)
- 4P A-level: 3 consecutive A-round losses → reset to LV 2
- 6P / 8P: no A-fail counter per scorer memory `project_rules_change_2026-05.md`

**Files to touch**: new — `lib/game/upgrade-6p.ts`, `upgrade-8p.ts`, `aLevel.ts`, `turn-order-multi.ts`, `tests/game/*`
**Effort**: 2-3 days

### UI-5 · Round-end / A-level / victory screens

**Goal**: Build wireframes #06, #07 — round-end with level ladder + A-final tension UI + victory screen.

**Depends on**: CORE-4, UI-2.

**Deliverables**:
- `src/screens/RoundEnd.tsx` — wireframe #06 implementation
- `src/screens/ALevelFinal.tsx` — wireframe #07 implementation with color-temperature shift
- `src/screens/Victory.tsx` — game-end celebration screen with MVP / final scores
- `src/components/LevelLadder.tsx` — 13-rung 2→A visualizer

**Acceptance**:
- After round-end: level ladder shows was/passed/now states correctly
- A-level state: page tint shifts to warm-red, A-fail counter visible (4P only)
- Victory: shows winning team + level history + replay/share buttons

**Files to touch**: new — `src/screens/RoundEnd.tsx`, `ALevelFinal.tsx`, `Victory.tsx`, `src/components/LevelLadder.tsx`
**Effort**: 2-3 days

### P3 Acceptance gate

A full game completes:
1. 4P room created with strict A-mode
2. 6+ rounds played including tribute (at least one 双下 with 还贡)
3. A-level reached, decisive round plays
4. Victory screen shows correctly
5. Stats sync to shared player profile (per AUTH-1)

---

## Phase 4 · Multi-player + AI Hard + assistance (week 6-7)

Goal: 6P and 8P fully working. Hard tier LLM bot. Player assistance features.

### UI-6 · 6/8-player table layouts

**Goal**: Build 6P and 8P landscape layouts per wireframe #05.

**Depends on**: UI-2, CORE-4.

**Deliverables**:
- `src/screens/GameTable6P.tsx` — 6-player layout (5 top + me + partner indicator)
- `src/screens/GameTable8P.tsx` — 8-player layout (5 top arc + 1 each side + me)
- `src/lib/seating.ts` — seat-to-screen-position mapper per mode
- E2E: 8P game with bots completes

**Acceptance**:
- 8P game playable on landscape phone with all 7 opponents visible
- Team color dots distinguish 4 teams clearly
- 13-card hand display works at narrow widths

**Files to touch**: new — `src/screens/GameTable6P.tsx`, `GameTable8P.tsx`, `src/lib/seating.ts`
**Effort**: 3-4 days

### ~~AI-2 · Hard tier LLM bot~~ — **SUPERSEDED 2026-05-19 by Bobgy WASM (Phase B)**

**Status**: LLM Hard tier deleted 2026-05-19 (LLM latency 1.5-3s/move × multiple bots is structurally incompatible with real-time card play; HANDOFF.md 2026-05-19 entry has the rationale). Hard tier returns via the Bobgy `poker-guandan-strategy` solver with lookahead policy on top — Phase A (decomposer) shipped 2026-05-21; Phase B (lookahead + Hard tier UI chip) remains a future session. See `docs/plan/bobgy/PHASE-A.md` §10. The deliverables/acceptance below are kept as historical reference for the LLM design that was rejected.

**Goal**: LLM bot with DeepSeek + candidate pre-filter per `ai-implementation-plan.md` §1.

**Depends on**: AI-1.

**Deliverables**:
- `lib/ai/bots/hard.ts` — Hard tier implementation
- `lib/ai/prompts/hard.zh.md` — Chinese system prompt template per ai-implementation-plan.md
- `lib/ai/llm/deepseek.ts` — Vercel AI Gateway DeepSeek client
- `lib/ai/llm/parse.ts` — LLM response parser (extract chosen candidate by index)
- `lib/ai/llm/fallback.ts` — fallback to Medium tier if LLM returns garbage
- Cost guardrail: `lib/ai/budget.ts` tracks monthly LLM spend, downgrades Hard → Medium at $50/month soft limit
- `tests/ai/hard.test.ts` — mocked LLM scenarios (good response / bad response / timeout)

**Acceptance**:
- 4P game with 1 human + 3 Hard bots completes
- Bot moves are 100% legal (candidate-mode prompt prevents garbage)
- p95 move latency < 5s (DeepSeek typical: 2-4s)
- Monthly cost dashboard shows actual spend tracking

**Files to touch**: new — `lib/ai/bots/hard.ts`, `lib/ai/prompts/hard.zh.md`, `lib/ai/llm/*`, `lib/ai/budget.ts`, `tests/ai/hard.test.ts`
**Effort**: 3-4 days
**Notes**:
- Hard tier 4P only at v1 launch — 6/8 partnership is too complex for current LLM
- Feature-flag via `FEATURE_AI_HARD=true` env var; default OFF in dev

### AI-3 · Player assistance — auto-sort + suggest + wildcard UI — **SHIPPED 2026-05-28**

**Goal**: Surface AI engine to human players via auto-sort, suggested move, and wildcard substitution dialog.

**Depends on**: AI-1, UI-2.

**Deliverables**:
- `src/lib/assist/sort.ts` — auto-sort by combo group (calls `lib/ai/engine.ts`)
- `src/lib/assist/suggest.ts` — suggested move (tap "提示" → returns highest-ranked candidate from engine)
- `src/components/SortButton.tsx` — "理牌" button with shuffle animation (~600ms)
- `src/components/SuggestionHint.tsx` — subtle glow on suggested cards + caption "建议: 一对 7 ♥♦"
- `src/components/WildcardSubDialog.tsx` — popup when playing combo using 红心级牌 ("用红心 5 当作什么?")
- `src/components/EndgameAssist.tsx` — opt-in endgame solver, gated on `assist-endgame-enabled` setting (default OFF)
- Settings UI for assist preferences

**Acceptance**:
- Tap "理牌" → cards rearrange to combo groups in 600ms
- Tap "提示" → suggested combo highlighted + caption shown
- Play combo using wildcard → substitution dialog appears, defaults to most plausible
- Toggle endgame assist ON → if 6 or fewer cards, hint shows clearing move

**Files to touch**: new — `src/lib/assist/*`, `src/components/SortButton.tsx`, `SuggestionHint.tsx`, `WildcardSubDialog.tsx`, `EndgameAssist.tsx`
**Effort**: 3-4 days
**Notes**:
- Assistance uses client-side WASM (per ai-implementation-plan.md §11) for instant feedback
- Ranked mode (v2) disables assistance entirely

### AI-4 · Mid-game DC takeover — **SHIPPED 2026-05-28**

**Goal**: When a human DCs > 60s, server promotes the slot to Medium bot, game continues seamlessly.

**Depends on**: AI-1, NET-2.

**Deliverables**:
- `lib/room/dcDetection.ts` — track per-player last-seen timestamp
- `lib/room/botTakeover.ts` — promote slot to bot after 60s timeout
- `api/cron/dcCheck.ts` — Vercel scheduled function runs every 30s, scans rooms for DC'd players
- Reclaim flow: if player reconnects with valid token within 5 min, bot stops and human resumes
- UI: `src/components/PlayerStatusBadge.tsx` shows DC / reconnecting / bot-takeover states
- `tests/integration/dcTakeover.test.ts`

**Acceptance**:
- Kill player tab → after 60s, slot shows "BOT 进阶 (代打)" badge, game continues
- Player rejoins with same token within 5 min → bot retires, human resumes
- After 5 min without reclaim, takeover is permanent for this game

**Files to touch**: new — `lib/room/dcDetection.ts`, `botTakeover.ts`, `api/cron/dcCheck.ts`, `src/components/PlayerStatusBadge.tsx`, `tests/integration/dcTakeover.test.ts`
**Effort**: 2-3 days

---

## Phase 5 · Production (week 7-8)

Goal: anti-cheat baseline + custom domain + observability. Production-ready.

### SEC-1 · Rate limiting

**Goal**: Implement per-route rate limits via `@upstash/ratelimit` sliding window.

**Depends on**: NET-1.

**Deliverables**:
- `lib/security/rateLimit.ts` — wrapper around `@upstash/ratelimit`
- Per-route limits:
  - `POST /move`: 10/handle + 5/IP per 5s
  - `POST /tribute/select`: 1 per turn per handle
  - `POST /room/create`: 10/hour per handle
  - `POST /room/[code]/join`: 50/hour per handle
  - SSE `/sse/[roomId]`: 1 active connection per handle (extra closes oldest)
- Apply to all `api/*` routes via middleware
- `tests/security/rateLimit.test.ts`

**Acceptance**:
- Spam POST /move from one IP → 429 response after limit hit
- Limit resets after window (sliding 5s)

**Files to touch**: new — `lib/security/rateLimit.ts`, `tests/security/*`; enhance all `api/*` routes
**Effort**: 1 day

### SEC-2 · IP throttle + same-room IP warning — **SHIPPED 2026-05-28**

**Goal**: Limit new account creation per IP + warn hosts when 2 players in same room share IP.

**Depends on**: SEC-1, AUTH-1.

**Deliverables**:
- `api/auth/createHandle.ts` — handle creation endpoint, gates on IP throttle
- `lib/security/ipThrottle.ts` — 5 accounts per IP per 24h via Upstash counter
- `lib/room/ipWarning.ts` — server check on join: if N other players in room share IP, send `same_ip_warning` event to host
- UI: `src/components/HostIPWarning.tsx` — shows warning chip in host's room UI

**Acceptance**:
- Create 6th account from same IP in 24h → blocked with error
- Two players from same IP join → host sees warning chip

**Files to touch**: new — `api/auth/createHandle.ts`, `lib/security/ipThrottle.ts`, `lib/room/ipWarning.ts`, `src/components/HostIPWarning.tsx`
**Effort**: 1 day

### SEC-3 · Report button + admin dashboard — **SHIPPED 2026-05-28**

**Goal**: In-game report button. Admin dashboard for reviewing reports + bans + stat reset.

**Depends on**: SEC-1, AUTH-1.

**Deliverables**:
- `api/report.ts` — POST report `{ reporterHandle, targetHandle, gameId, reason }` (reason enum)
- `lib/security/reports.ts` — persist + dedupe (max 1 per pair per game)
- `src/components/ReportButton.tsx` — in-game report UI with reason picker
- `src/screens/AdminDashboard.tsx` — gated by `ADMIN_TOKEN` env (same pattern as sibling scorer)
  - View recent reports
  - Browse player profiles
  - Ban handle (set `banned: true` flag in profile)
  - Reset stats
- `api/admin/*.ts` — admin endpoints (ban, reset-stats, view-reports), gated by token

**Acceptance**:
- Report submission persists to KV
- Admin dashboard at `/admin?token=$ADMIN_TOKEN` loads reports
- Ban toggles a flag; banned handle cannot join new games

**Files to touch**: new — `api/report.ts`, `lib/security/reports.ts`, `src/components/ReportButton.tsx`, `src/screens/AdminDashboard.tsx`, `api/admin/*`
**Effort**: 2-3 days

### SEC-4 · Vercel BotID integration — **SHIPPED 2026-05-28** (verdict gate; edge SDK activation deploy-gated)

**Goal**: Enable Vercel BotID on `/api/*` routes for automated bot detection at edge.

**Depends on**: NET-1.

**Deliverables**:
- `vercel.json` (or `vercel.ts`) configuration to enable BotID on `/api/*`
- `lib/security/botId.ts` — read BotID verdict from request headers, deny obvious bots
- Allowlist for friendly-bot UA strings (our own scheduled functions, monitoring probes)

**Acceptance**:
- Curl with default UA → blocked by BotID (or challenged)
- Real browser → passes through

**Files to touch**: `vercel.json` / `vercel.ts`, new `lib/security/botId.ts`
**Effort**: 0.5 days

### DEPLOY-1 · Custom domain + SSL + Vercel project setup

**Goal**: Create Vercel project, link GitHub repo, register custom domain, deploy.

**Depends on**: all P4 milestones (need a deployable app).

**Deliverables**:
- Vercel project created and linked to `xingfanxia/guandan-online` GitHub repo
- Custom domain registered: **gdo.ax0x.ai** (sibling to scorer at gd.ax0x.ai)
- DNS A/CNAME records configured
- SSL cert issued (Vercel automatic)
- Environment variables set: `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or UPSTASH-prefixed aliases — see `lib/realtime/infra.ts`), `ADMIN_TOKEN` (for `/api/cron/cleanup-rooms` Bearer auth, fail-closed without)
- Production deployment promoted

**Acceptance**:
- `https://<custom-domain>` loads landing page
- SSL cert valid
- Cold start < 500ms for landing page
- Mainland China user can access via custom domain (`*.vercel.app` would fail)

**Files to touch**: `vercel.json`, `.env.example`, Vercel project settings (UI)
**Effort**: 0.5-1 day
**Notes**:
- All relative TS imports MUST end in `.js` (e.g. `from './foo.js'` for `foo.ts`) — required for Vercel cloud builds; @vercel/node's per-function tsc check runs under `nodenext` moduleResolution. Migration applied 2026-05-21 via `scripts/migrations/add-js-extensions.py` (idempotent). Root `tsconfig.json` mirrors `tsconfig.app.json` compilerOptions so the per-function check sees `strict: true` + `types: ["node"]`. If you add new code with extensionless imports, re-run the migration script.
- GitHub auto-deploy is the canonical path (since 2026-05-21); `vercel deploy --prebuilt --prod` from local is the fallback if cloud builds break.

### DEPLOY-2 · Client-side latency beacons + p50/p95 monitoring — **SHIPPED 2026-05-28** (logic; real-traffic acceptance deploy-gated)

**Goal**: Collect real-user latency data. Display in admin dashboard. Trigger DEPLOY-3 if PRC p95 > 350ms.

**Depends on**: DEPLOY-1.

**Deliverables**:
- `src/lib/telemetry/beacon.ts` — measures POST `/move` round-trip time, sends to `/api/telemetry/latency`
- `api/telemetry/latency.ts` — receives beacons, persists to Upstash counter with `region` dimension
- `lib/telemetry/aggregate.ts` — periodic aggregation to p50/p95/p99 per region
- Admin dashboard latency panel — shows real-time numbers per region
- Alert: if PRC p95 > 350ms for 7 consecutive days, log + flag for DEPLOY-3 decision

**Acceptance**:
- Latency data appears in admin dashboard after 1 hour of usage
- PRC p95 calculation correct (using Vercel's `req.geo.country` for tagging)

**Files to touch**: new — `src/lib/telemetry/beacon.ts`, `api/telemetry/latency.ts`, `lib/telemetry/aggregate.ts`
**Effort**: 1 day

### P5 Acceptance gate

Launch-ready:
- Custom domain serves traffic over HTTPS
- All 4 anti-cheat measures active
- Admin dashboard works for moderation
- 1 week of soak testing passed (no crashes, no SSE leaks, no rate-limit false positives)
- Telemetry shows real latency from real users

---

## Polish (v1.1+) — deferred but documented

### POLISH-1 · Animations
- Card deal cascade (30ms stagger, 4-5s total)
- Card play arc to center (separate axes: translateX linear + translateY ease-out)
- Level-up celebration (gold glow + scale-up on level rung)
- Victory confetti or equivalent (use Lottie or CSS-only)
- Budget: 1 week

### POLISH-2 · Sound design
- Card slide whoosh on play
- Card flip on deal
- Trick clear (cards fade to history)
- Level-up chime
- Victory fanfare
- Use Web Audio API + small MP3 set (~20 sounds, < 100 KB total)
- Settings toggle for sound on/off + volume slider
- Budget: 1 week

### POLISH-3 · Ranked mode + Elo ladder
- Separate ranked queue (4P / 6P / 8P)
- Phone verification gate (out-of-scope auth integration)
- Elo calculation per Glicko-2 or simplified Elo
- Leaderboard view
- Anti-cheat: ranked mode disables player assistance entirely
- Budget: 2-3 weeks

### POLISH-4 · DanLM Master tier
- Open issue with DanLM author re: Linux deployment
- If unresolved: own ONNX export / re-training
- If resolved: integrate as 4th tier
- Budget: 1-2 weeks (after upstream resolves)

### DEPLOY-3 · Tencent Cloud Shenzhen mirror (conditional)
- Only deploy if PRC p95 > 350ms observed for 7+ days
- Tencent Cloud Run + Aliyun CDN
- Vercel Edge Middleware for geo-routing (`req.geo.country === 'CN'` → rewrite to TCB)
- Shared Upstash Singapore for game state
- Budget: 1 week

---

## Risk register (live document — update during execution)

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R-01 | Rules engine port has bugs | Medium | High | CORE-1 acceptance requires 95% coverage + 100+ tests | dev |
| R-02 | SSE+POST glue introduces hidden-state leak | Low | Critical | NET-3 grep test on every PR + manual audit | dev |
| R-03 | LLM Hard tier plays badly, ruins games | Medium | Medium | Feature-flag, Elo bench gate, fallback to Medium | dev |
| R-04 | iOS CSS rotate breaks on some device | Medium | Medium | UI-2 multi-device test matrix; rotate-prompt fallback | dev |
| R-05 | PRC GFW kills SSE → game unplayable | Low | High | NET-2 keepalive + long-poll fallback; if persists, DEPLOY-3 | dev |
| R-06 | DanLM author doesn't respond → no v1.1 Master tier | Medium | Low | Document deferral; Hard is good enough at launch | dev |
| R-07 | AUTH-2 scorer migration breaks production | Low | High | Fallback-read pattern; deploy off-peak; monitor errors | dev |
| R-08 | Tribute edge case missed → game stuck | Medium | High | TRIBUTE-1 acceptance tests cover all 3 modes + 抗贡 + timeout | dev |
| R-09 | License check fails on guandan-guide port | Low | Medium | Port semantics not source; or stop and use only zdhgg + Bobgy | dev |
| R-10 | 27-card hand doesn't fit on iPhone SE landscape | Medium | Low | Two-row fallback at <600px; tested in UI-2 | dev |

---

## Timeline (calendar)

| Week | Milestones | Demo |
|---|---|---|
| 1 | CORE-1 + AUTH-1 start, AUTH-2 in sibling | Rules engine passes 100 tests |
| 2 | NET-1 + NET-2 + NET-3, CORE-2 | Two browsers exchange SSE messages |
| 3 | UI-1 + UI-2 + AI-1 + ROOM-1 | First 4P game with bots end-to-end |
| 4 | UI-3 + ROOM-2 + ROOM-3 | Full room lifecycle: create with rules → invite → play |
| 5 | TRIBUTE-1 + UI-4 + CORE-3 + CORE-4 | Tribute phase working |
| 6 | UI-5 + UI-6 + AI-2 + AI-3 | 8P + Hard LLM + player assistance |
| 7 | AI-4 + SEC-1..4 + DEPLOY-1 | Production deploy with anti-cheat |
| 8 | DEPLOY-2 + soak test + bug fixes | LAUNCH 🚀 |

---

## Plan revision log

| Date | Change |
|---|---|
| 2026-05-16 | Initial plan drafted from 13 research streams |
| 2026-05-19 | AUTH-2 cancelled (per-app independent Upstash; no shared key space); AI-2 LLM Hard tier deleted (latency structural, not tuneable — Hard returns post-WASM via deeper Bobgy search depth). See `docs/research/SUMMARY.md` decisions #15 + #16. |
| 2026-05-21 | DEPLOY-1 GitHub auto-deploy unblocked (commit `edeb6c7`): migrated 275 relative TS imports to `.js` suffixes + added `compilerOptions` to root `tsconfig.json`. DEPLOY-1 env vars list updated (dropped stale `DEEPSEEK_API_KEY` + `FEATURE_AI_HARD` left over from the cancelled AI-2). Project convention: `.js` extensions on all relative TS imports — see `scripts/migrations/add-js-extensions.py`. |
