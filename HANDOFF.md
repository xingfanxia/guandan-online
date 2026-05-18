# Handoff — guandan-online v1.0 (backend wire-complete end-to-end)

**Date**: 2026-05-18
**Status**: backend is end-to-end wire-complete. 8 HTTP/SSE routes shipped, publishEvent fanout closes the loop on move + game-start, per-recipient log keying isolates SSE backlog from cross-player leaks, trick_won events derive automatically. Tests **629/629** · TS strict clean · grep-no-leak gate green · `main` synced to `origin/main`. The end-to-end integration test (`tests/integration/full-game-flow.test.ts`) drives create → join × 3 → start → SSE-subscribe → play → pass and asserts SSE delivers deal + move_played + move_passed + stream_closing with correct payloads. Remaining substantive work: GameSession persistence for round_end / game_end events, lifecycle event fanout (room_joined / room_left — has version-namespace design note below), UI-1/UI-2, AUTH-2 (Critical Decision), AI-2 Medium.
**Repo**: https://github.com/xingfanxia/guandan-online
**Domain (locked)**: `gdo.ax0x.ai` (sibling subdomain to scorer at `gd.ax0x.ai`)

---

## Progress

### 2026-05-17 — P0 kick-off session (4 commits)

| Commit | Milestone | What |
|---|---|---|
| `1672b4c` | Bootstrap | Vite 8 + TS 6 + React 19 + Vitest 4 scaffold, Vercel Fluid Compute config, dir skeleton, smoke test |
| `c4310a4` | AUTH-1 | `lib/auth/` — `validateOwnershipToken` + `extractBearerToken` + handle normalization. 32 tests |
| `af9c409` | CORE-1 part 1 | `lib/game/` foundation — `mode.ts` / `levels.ts` / `cards.ts` / `upgrade.ts` / `aLevel.ts`. 79 tests |
| `ee10818` | Docs sync | HANDOFF / CLAUDE / README aligned for P0 kickoff |

### 2026-05-18 — Autonomous-grind push (25 commits)

| Commit | Milestone | Lib paths |
|---|---|---|
| `680235a` | CORE-1 part 2 | `wildcard.ts` / `bomb.ts` (7-tier power) / `patterns.ts` (all 10 kinds + `analyzeHand` + `canBeat`) |
| `c86a7fc` | CORE-2 part A | `round.ts` — `GameRound` + `Trick` types, deal, startTrick / playCards / pass, going-out, 接风, round-end at N-1 |
| `3db01cf` | CORE-2 part B | `resolveRound.ts` — bridge finished round → `calculateUpgrade` |
| `2e62966` | NET-1 part A | `realtime/messages.ts` (15-kind ServerEvent union) + `realtime/sse.ts` (wire format) |
| `858b68f` | NET-1 part B | `realtime/commands.ts` (6 MoveCommand variants) + `realtime/eventBus.ts` (in-memory) |
| `1f53452` | NET-2 part A | `realtime/idempotency.ts` (reserve / commit) + `realtime/eventLog.ts` (append / range) |
| `d518bf6` | NET-3 part A | `realtime/buildClientPayload.ts` — hidden-state filter + leak detector |
| `991541f` | NET-3 part B | `realtime/publish.ts` (single gateway) + `scripts/security/grep-no-leak.sh` |
| `0737db5` | CORE-3 | `game/session.ts` — multi-round orchestrator + game-end detection |
| `ae55815` | ROOM-1 part A | `room/code.ts` — 6-char alternating L/D ambiguity-safe code generator |
| `88adffe` | AI-1 part A | `ai/enumerate.ts` — same-rank family enumeration |
| `eaa1acb` | AI-1 part B | `ai/easy.ts` — Easy bot move selector (30% noise) |
| `0279ba5` | Realtime | `realtime/cardCodec.ts` — CardId ↔ Card |
| `886163c` | Realtime | `realtime/handleMove.ts` — POST /move dispatcher (version / turn / pattern checks) |
| `fad1e6b` | ROOM-1 part B | `room/lifecycle.ts` — RoomState + create / join / leave / isStale |
| `5e61fd9` | Game util | `game/handSort.ts` — canonical 理牌 ordering |
| `a30f4db` | AI-1 part C | sequence enumeration (straight / threePairs / twoTriples) |
| `8c3f660` | Integration | `tests/integration/easy-bot-game.test.ts` — full 4P round with 4 Easy bots |
| `318d35e` | TRIBUTE-1 part A | `game/tribute.ts` — `detectTributeMode4P` (single / double / 抗贡) |
| `10b9671` | TRIBUTE-1 part B | `pickTributeCard` + `pickReturnCard` (wildcard exemption, ≤10 cap) |
| `a1cbac2` | TRIBUTE-1 part C | `applyTribute` — end-to-end exchange + first-leader determination |
| `a0514bf` | AI utility | `ai/timing.ts` — Beta(2,5) bot move delay |
| `b5f4da1` | AI utility | `ai/names.ts` — Chinese bot handle + tier badge |
| `018c908` | SEC-1 part A | `security/rateLimit.ts` — sliding-window limiter |
| `b37d06a` | AI-1 part D | flushStraight enumeration |
| `9344e86` | AI-1 part E | fullHouse enumeration — enumerator now covers all 10 PatternKinds |

### 2026-05-18 — NET-1C + API routes session (9 commits)

| Commit | Milestone | What |
|---|---|---|
| `214d1f4` | NET-1C part 1 | `lib/realtime/redisClient.ts` (RedisLike contract) + `createUpstashIdempotencyCache` via SET NX EX + PENDING sentinel. grep-no-leak whitelist extended for the interface declaration. |
| `c239252` | NET-1C part 2 | `createUpstashEventLog` — Redis Streams (XADD with INCR-driven `<n>-0` ids, XRANGE with exclusive `(<n>-0` bound for fromId). 24h TTL on both stream + seq keys. |
| `076bab2` | NET-1C part 3 | `createUpstashEventBus` — XADD `*` to `bus:<channel>` stream + setTimeout poll loop (no real SUBSCRIBE on Upstash REST). Live-only cursor seeded at current stream top. |
| `d7cabec` | NET-1C part 4 | `createRealtimeInfra(env, opts?)` factory — single entry point selecting memory vs Upstash by env vars. Tests inject RedisLike via `options.redis`. |
| `02c2fa3` | API-1 | `lib/storage/roomStore.ts` (Memory + Upstash impls) wired into RealtimeInfra. RedisLike gains `del()`. |
| `eb8f691` | API-2 | `POST /api/room/create` — pure handler `lib/api/createRoom.ts` + Vercel wrapper. Code-collision retry (cap 8) on `roomStore.create()` NX. |
| `21e24a4` | API-3 | `POST /api/room/[code]/join` + `.../leave` — pure handlers + wrappers. Leave authenticates via Bearer joinToken; host leaving → DEL room. |
| `4839c07` | API-4 part A | `POST /api/room/[code]/move` — auth + sliding-window rate limit + idempotency reserve/commit + handleMoveCommand dispatch + roundStore persistence. `'applied' → 'replayed'` tag on retries. `lib/storage/roundStore.ts` introduced. Event fanout deferred to API-4 part B. |
| `e094685` | API-5 | `GET /api/sse/[roomId]` — backlog drain via `eventLog.range` + live `eventBus.subscribe` on `game:<code>:player:<id>` channel + 20s heartbeat + 270s rotation with `stream_closing` event. ReadableStream cancel cleans up timers + unsubscribes. |

**Stats**: **590/590 tests passing** (up from 487; 103 new tests) · TS strict clean · grep-no-leak gate green · 9 commits on `main` pushed to `origin/main`.

### 2026-05-18 — extension session (7 commits)

| Commit | Milestone | What |
|---|---|---|
| `d4178ff` | API-4 part B | publishEvent wiring from move handler. `lib/realtime/buildGameState.ts` derives GameState from (RoomState, GameRound); `lib/realtime/deriveMoveEvent.ts` produces AuthorEvent[] from (command, preRound, postRound). Move handler emits `move_played` / `move_passed` after successful dispatch. `combinationLabel` filled from `analyzeHand().kind`. |
| `7398610` | API-6 | `POST /api/room/[code]/start` — host-authenticated game-start. Alternating-team seat assignment, deterministic shuffle, dealRound + startTrick, RoundEnvelope persisted at version 0, AuthorDealEvent fanned out. |
| `941fa1a` | INT-1 | End-to-end integration test walking createRoom → 3× join → startGame → handleSse → handleMove × 2. Asserts SSE delivers deal + move_played + move_passed + stream_closing with correct payloads. |
| `75424ee` | SEC-2 | Per-recipient EventLog keys (`eventLogKey(roomId, playerId)`) close a backlog leak: previously `log.append(roomId, ...)` mixed all recipients' filtered payloads under one key, so SSE resume to player A would replay player B's "yourHand". Regression guard test added. |
| `e49c480` | API-7 | `GET /api/room/[code]` — public room view. Explicit allow-list shape strips hostToken + joinTokens. Lets clients render lobby UI on initial page load. |
| `3f79e4c` | EVT-1 | `deriveMoveEvent` now returns AuthorEvent[]. Appends `trick_won` event when preRound.currentTrick → null transition. Move handler advances roundEnvelope.version to the LAST emitted event so optimistic-concurrency stays aligned with per-recipient SSE log seq. |

**Stats**: **629/629 tests passing** · TS strict clean · grep-no-leak gate green · 7 commits pushed.

**License decision (CORE-1 part 2)**: Ported semantics from the in-repo `docs/research/game-rules.md` spec. No source code copied from `hash-panda/guandan-guide`. `// SYNC:` pins reference spec sections, not external code.

**Outstanding work**:
- **GameSession persistence + round_end / game_end events** — `lib/game/session.ts` defines `GameSession { teamLevels, teamAFails, roundOwner, finishedRounds, phase, winnerTeam }` but nothing in the API layer persists it. Without it, `round_end` (which needs newLevels per team) and `game_end` (which needs winnerTeam) can't be derived. Adds: `lib/storage/sessionStore.ts`, wiring into startGame (create session), wiring into move handler (call resolveRound on round-end transition, update session, emit round_end + maybe game_end). ~300 LOC including tests.
- **Lifecycle event fanout** — `room_joined` / `room_left` from join/leave routes. Design note: with per-recipient log keys (SEC-2), each recipient has their own monotonic seq. `event.version` doubles as the SSE `id:`. For the alignment to hold across lifecycle + game phases, lifecycle events need to draw from a shared monotonic counter (probably `RoomState.eventVersion: number = 0`, bumped on every publish). Game-start would init `RoundEnvelope.version` from `room.eventVersion + 1` so the deal continues the namespace. Late-joiners have a gap (events published before their join aren't on their key) which is fine as long as their Last-Event-ID starts at 0 — they only resume from events published after they joined. Lower urgency than moves; same wiring pattern once the counter design lands.
- **UI-1 / UI-2** — landscape mobile gameplay screens (demos in `demos/index.html` are pixel refs).
- **AUTH-2** — sibling scorer key migration `player:*` → `gs:*`. **CRITICAL DECISION TRIGGER — touches production sibling KV. Requires explicit go-ahead.**
- **AI-2 Medium** — WASM solver + partner cooperation (longest single milestone, 7-10 days per PLAN.md).
- **Cron cleanup of stale rooms** — `isStale(room, now, ttlMs)` exists in `lib/room/lifecycle.ts` but no scanning surface; would need a room-code index (set of active codes per Redis key) and a `api/cron/cleanup-rooms.ts` Vercel cron handler. ~150 LOC.

---

## What's in this repo

Three deliverable layers, each fully complete and committed:

### 1. Research (`docs/research/`) — 14 documents · ~70K words · 8,200+ lines

| File | Purpose |
|---|---|
| [`SUMMARY.md`](docs/research/SUMMARY.md) | Cross-cutting synthesis · 14 locked decisions · 10 ranked risks |
| [`ai-strategies.md`](docs/research/ai-strategies.md) | 5 reference AI engines analyzed |
| [`game-rules.md`](docs/research/game-rules.md) | Complete Guandan ruleset (cards / patterns / bombs / wildcards / A-level / 4/6/8-mode differences) |
| [`existing-implementations.md`](docs/research/existing-implementations.md) | Open-source + commercial UX scan |
| [`architecture-options.md`](docs/research/architecture-options.md) | Realtime transport options (Vercel SSE+POST locked) |
| [`mobile-landscape-ux.md`](docs/research/mobile-landscape-ux.md) | Orientation lock + CSS rotate Majsoul pattern |
| [`realtime-sync-deep-dive.md`](docs/research/realtime-sync-deep-dive.md) | Production card-game sync survey + prescriptive Vercel SSE+POST spec |
| [`ai-implementation-plan.md`](docs/research/ai-implementation-plan.md) | Per-tier AI algorithm pseudocode + player assistance |
| [`tribute-ux-deep-dive.md`](docs/research/tribute-ux-deep-dive.md) | 进贡/还贡/抗贡 + 6P/8P sweep paths + 换牌 rule |
| [`card-visual-assets.md`](docs/research/card-visual-assets.md) | Unicode + Geist verdict (zero external SVG) |
| [`china-network-deployment.md`](docs/research/china-network-deployment.md) | PRC reachability + Tencent Cloud fallback path |
| [`anti-cheat-deep-dive.md`](docs/research/anti-cheat-deep-dive.md) | Account-level + collusion + scripted-client mitigation |
| [`cross-project-integration.md`](docs/research/cross-project-integration.md) | Sibling scorer @handle namespace bridge (Option B) |
| [`card-game-ui-conventions.md`](docs/research/card-game-ui-conventions.md) | 斗地主 + 德扑 oval table layout patterns |

### 2. Plan (`docs/plan/`)

| File | Purpose |
|---|---|
| [`README.md`](docs/plan/README.md) | Phase model + dependency graph + naming convention |
| [`PLAN.md`](docs/plan/PLAN.md) | Master execution plan · ~31 milestones across 6 phases · per-milestone (goal, deps, deliverables, acceptance, files, effort) · 10-row risk register · 8-week calendar |

### 3. Wireframes (`demos/`)

| File | Purpose |
|---|---|
| [`index.html`](demos/index.html) | Hi-fi wireframe gallery · 23 scenes · open in browser |
| [`tokens.css`](demos/tokens.css) | Design tokens (oklch palette · Geist font · spacing/radius/shadow) |
| [`shared.css`](demos/shared.css) | Reusable components (card · panel · chip · button · avatar · phone frame) |
| `preview-v6-final.png` | Latest screenshot |

**23 scenes overview**:

- **Part 1 (S01-10)**: Landing / Create / 4P Game / Tribute (4P) / 6P / 8P / Round End / A-Level / Desktop / CSS Rotate
- **Part 1 (S11)**: Waiting (host-controlled, no auto AI countdown)
- **Part 2 (S12-19)**: Tribute pending / 抗贡 / 还贡 / 报警 / Wildcard / Ranked / Admin / DC + AI takeover
- **Part 3 (S20-23)**: 6/8P normal tribute / 6/8P sweep multi-pair tribute / 换牌 vote / 换牌 selection

---

## Locked decisions (do not revisit unless new info arrives)

1. **Realtime**: Vercel SSE+POST + Upstash Redis pub/sub (NOT Colyseus / NOT PartyKit for v1)
2. **Mobile orientation**: CSS `transform: rotate(90deg)` (Majsoul-style) on iOS, native lock on Android, rotate-prompt as emergency fallback
3. **Rendering**: CSS DOM + transform/opacity (NOT WebGL / PixiJS / Phaser / Canvas)
4. **Card visual**: Unicode suits + Geist 700 + tabular-nums (NO external SVG decks for v1)
5. **Card back**: CSS `repeating-linear-gradient` using existing tokens
6. **Wildcard treatment**: Gold edge stroke + ★ corner badge
7. **AI tier strategy**: Different engines per tier (Easy/Medium/Hard); DanLM Master deferred to v1.1
8. **Auth**: Anonymous @handle, **shared namespace with sibling scorer** (Option B)
9. **PRC delivery**: Vercel-only launch with client-side latency beacons; Tencent Cloud Shenzhen mirror deferred until p95 > 350ms observed
10. **Custom domain required day 1**: `gdo.ax0x.ai`
11. **Tribute defaults**: tournament rule baseline (server auto-picks; "贡左还右" direction; 还贡 ≤10 cap)
12. **Anti-cheat v1**: Rate limit + IP throttle + report + admin + Vercel BotID (~340 LOC, 5-6 days)
13. **6P/8P sweep tribute**: only triggers in 2-teams-of-N modes; rank-order multi-pair tribute
14. **换牌 optional rule**: OFF by default; if ON, losing team votes after round-end (>50% pass) + 3-card swap in server-RNG direction
15. **Waiting room**: host-controlled, no auto AI countdown — per-slot chip picker for difficulty/team
16. **Avatar fill color**: must match team-color ring (A=blue / B=red / C=green / D=gold)

---

## Top 10 risks (with mitigation)

| ID | Risk | Mitigation |
|---|---|---|
| R-01 | Rules engine port has bugs | CORE-1 requires 95% coverage + 100+ tests |
| R-02 | SSE+POST glue introduces hidden-state leak | NET-3 grep test on every PR + manual audit |
| R-03 | LLM Hard tier plays badly | Feature-flag, Elo bench gate, fallback to Medium |
| R-04 | iOS CSS rotate breaks on some device | UI-2 multi-device test matrix; rotate-prompt fallback |
| R-05 | PRC GFW kills SSE | NET-2 keepalive + long-poll fallback; if persists, DEPLOY-3 |
| R-06 | DanLM author doesn't respond → no v1.1 Master tier | Document deferral; Hard is good enough at launch |
| R-07 | AUTH-2 scorer migration breaks production | Fallback-read pattern; deploy off-peak; monitor errors |
| R-08 | Tribute edge case missed → game stuck | TRIBUTE-1 covers all 3 modes + 抗贡 + sweep + timeout |
| R-09 | License check fails on guandan-guide port | Port semantics not source; fall back to zdhgg + Bobgy |
| R-10 | 27-card hand doesn't fit on iPhone SE landscape | Two-row fallback at <600px; tested in UI-2 |

---

## Implementation entry points

When you (or future Claude session) starts coding:

1. **Read first**: `docs/plan/PLAN.md` from top
2. **Start P0**: AUTH-2 (sibling repo first), CORE-1 (rules engine), NET-1 (transport scaffold)
3. **Track milestones** via `<MILESTONE>-N` naming convention (see `~/.claude/CLAUDE.md`)
4. **Verify hidden-state safety** as security-critical PR gate (NET-3 grep test)
5. **Test acceptance gates** per phase (see PLAN.md phase summary)

---

## Critique pass results (3-pass review · 2026-05-17)

| Pass | Focus | Result |
|---|---|---|
| Pass 1 | Visual consistency | ✅ All 23 scenes use shared tokens.css + shared.css. Team color rings/fills aligned post-fix. Card sizes consistent. Phone frame consistent at 852×393. |
| Pass 2 | Information accuracy (Guandan rules) | ⚠️ Found 1 logical bug — S21 sweep tribute mixed avatars from 4-teams-of-2 mode (mathematically impossible to have 4 winners same team). Fixed: S21 now explicitly 2-teams-of-N mode with all losers team B. Scene-note + rule strip + annotation updated. |
| Pass 3 | AI slop check | ✅ Real Chinese @handles (no John Doe). Real room codes (K7M2P9, P3R8K1). Real Guandan game terms throughout. No emoji-as-icons. No glassmorphism. No purple gradients. tabular-nums everywhere. Trick text max-width prevents bleed. Card fills match team ring color. |

---

## Known limitations / deferred to v1.1+

- **DanLM Master tier AI**: macOS-only `.so` files; Linux port unresolved upstream
- **PRC Tencent mirror (DEPLOY-3)**: conditional; only deploy if real-user p95 > 350ms
- **Animations (POLISH-1)**: deal cascade / play arc / level-up choreography
- **Sound design (POLISH-2)**: card play sounds / shuffle / chime
- **Ranked mode + Elo ladder (POLISH-3)**: gated on phone-verification flow
- **i18n**: Chinese only at v1; EN/JP deferred
- **Replay export**: defer to v2 (post-launch when patterns emerge)

---

## Sibling project linkage

This project is the **online multiplayer game**. Its sibling [`guandan-scorer`](../guandan-scorer) is the **in-person scoring app**.

Integration boundary:
- Shared `@handle` namespace (Upstash KV prefix `gs:player:*` for scorer + `go:*` for online)
- Same Upstash instance (shared profile read; per-app game state writes)
- Online copies `validateOwnershipToken` (10 lines) from `scorer/api/players/_utils.js`
- Cross-app stat sync deferred to v1.2

Pre-implementation step (must happen before any AUTH-1 work in this repo):
- Migrate scorer's `player:*` keys → `gs:player:*` prefix (AUTH-2 milestone)
- ~15 file edits in sibling repo + one-time migration script
- Fallback-read pattern during rollout

---

## Quick links

- **Repo**: https://github.com/xingfanxia/guandan-online
- **Local demos**: `open demos/index.html`
- **Live (after deploy)**: `https://gdo.ax0x.ai`
- **Sibling scorer (production)**: `https://gd.ax0x.ai`
