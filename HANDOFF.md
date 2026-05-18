# Handoff — guandan-online v1.0 (backend + all UI + bot-fill + auto-tribute + Hard async shipped)

**Date**: 2026-05-18
**Status**: backend feature-complete + **all UI tracks shipped (UI-1/2/3/4/5/6)** + bot dispatch wired in the move handler + full AI tier ladder + **host-controlled bot fill at game-start** + **TRIBUTE-1 part D auto-tribute realtime wiring** + **Hard tier async via runBotsAsync**. 9 HTTP/SSE routes plus the complete React 19 game surface — lobby flow (Landing / CreateRoom / Waiting), GameTable4P + shared GameTableMP for 6P/8P, TributeModal (4 substates), RoundEnd / ALevelFinal / Victory, and three AI tiers (Easy + Medium with partner cooperation + Hard via Vercel AI Gateway with 5 silent-fallback triggers). The session lifecycle is fully event-driven end-to-end: `room_joined` / `room_left` from lobby, `deal` from game-start, `move_played` / `move_passed` / `trick_won` / `round_end` / `game_end` / **`tribute_pending` / `tribute_resolved` / next-round `deal`** from gameplay — all flowing through the single publishEvent gateway with per-recipient log keys and a contiguous version namespace across the lobby → game boundary so a single SSE `Last-Event-ID` resumes cleanly across phase transitions. After a human's move applies, an in-handler **async** bot run-loop (`lib/ai/runBots.ts` → `runBotsAsync`) computes + publishes bot turns until landing on a human or round-end; Hard tier awaits chooseHardMove with injected `generate` / `budget` deps (no LLM client wired → silent Medium fallback). Tests **922/922** · TS strict clean · `pnpm build` green (41 modules → 233kB JS / 41kB CSS gzip) · grep-no-leak gate green · `main` at `133ed0f` synced to `origin/main`. The end-to-end integration test (`tests/integration/full-game-flow.test.ts`) walks create → join × 3 (with lifecycle events published) → start → SSE-subscribe → play → pass and asserts the full event sequence including lifecycle backlog. Remaining substantive work: AUTH-2 (Critical Decision — sibling KV migration), TRIBUTE-1 part E (manual `tribute_select` command dispatch + UI hookup), `createUpstashBudget()` for production budget persistence, production Vercel AI Gateway client wiring.
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

### 2026-05-18 — backend-completion session (3 commits)

| Commit | Milestone | What |
|---|---|---|
| `45222be` | SESSION-1 | GameSession persistence + round_end / game_end events. `lib/storage/sessionStore.ts` (Memory + Upstash impls). `lib/realtime/deriveRoundEndEvents.ts` produces AuthorEvent[] for round_end (always when round ends) and game_end (when applyRoundResult sets phase='finished'). Move handler loads session on every move whose dispatch sets `newRound.phase === 'finished'`, calls applyRoundResult, persists new session, appends round_end (+ optional game_end) to events array with sequential versions, updates response.appliedVersion so client's next fromVersion is correct. startGame creates session at game-start. |
| `95b4ff4` | LIFECYCLE-1 | room_joined / room_left fanout with shared event counter. `RoomState.eventVersion: number` (default 0); joinRoom + leaveRoom bump it as part of the pure state transition. `lib/realtime/deriveLifecycleEvents.ts` produces room_joined / room_left AuthorEvents. `lib/realtime/buildLobbyGameState.ts` builds a placeholder GameState (empty hands per member) for publishing pre-game-start events. handleJoinRoom + handleLeaveRoom accept optional bus + log deps and publish via the existing gateway. startGame consumes `room.eventVersion + 1` as the deal version so per-recipient SSE log seq stays contiguous across lobby → game boundary. Existing fixtures updated with `eventVersion: 0`. |
| `2b6fb4e` | CRON-1 | Stale-room cleanup endpoint + active-codes index. RedisLike gains `sadd / srem / smembers`. roomStore.create + delete maintain `<prefix>active` Redis set; new `listCodes()` enumerates active codes. `lib/api/cleanupRooms.ts` is a Bearer-ADMIN_TOKEN-authed handler with constant-time compare that scans listCodes(), deletes stale rooms (lastActiveAt past stalenessMs, default 4h), and reconciles ghost index entries whose data has already TTL'd out. `api/cron/cleanup-rooms.ts` is the Vercel cron route wrapper. vercel.json crons entry runs hourly. Fail-closed when ADMIN_TOKEN env unset (returns 503). |

**Stats**: **676/676 tests passing** (up from 629; +47 new tests across sessionStore, deriveRoundEndEvents, move-handler round_end/game_end emission, deriveLifecycleEvents, buildLobbyGameState, lifecycle event integration, cleanupRooms, roomStore index). TS strict clean. grep-no-leak gate green. 3 commits pushed.

### 2026-05-18 — UI + AI track session (4 commits)

| Commit | Milestone | What |
|---|---|---|
| `5d2f959` | UI-1 | Card / Hand / Trick / Avatar React primitives + design tokens. `src/styles/{tokens,components}.css` are verbatim ports of `demos/{tokens,shared}.css`; `src/components/{Card,Hand,Trick,Avatar}.tsx` follow wireframe S03 markup. Card primitive ships 28/40/56px size variants, lifted state, wildcard treatment (gold edge + ★) keyed off `lib/game/cards.ts:isWildcard(card, levelRank)`, and `card--back` face-down rendering. Test infra: jsdom + @testing-library/react + @testing-library/jest-dom installed, vitest.config.ts gains `.test.tsx` pattern + `tests/setup/jest-dom.ts` setup. 30 new component tests. Side-effect CSS imports declared via `src/types/css.d.ts`. |
| `2436f87` | UI-2 | OrientationLock + RotatePrompt + GameTable4P live SSE. `src/lib/orientation.ts` exports `useOrientation()` + `lockLandscape()`; SSR + jsdom safe. `src/screens/RotatePrompt.tsx` is the universal-fallback overlay (per research: NOT a CSS-transform-rotate game body — that breaks touch coords + viewport units + virtual keyboard). `src/screens/GameTable4P.tsx` subscribes to `/api/sse/[roomId]` via the new `src/lib/sseClient.ts` (EventSource with `?token=` auth since EventSource can't set headers), maintains state via a pure `reduceEvent()` reducer covering 7 server-event kinds, and POSTs `play`/`pass` commands with `crypto.randomUUID()` moveId for idempotency. `src/styles/game-table.css` extracts the S03 layout primitives. `src/App.tsx` mounts the table when hash route `#table=<roomId>&token=<t>&me=@handle` is present. 24 new tests. |
| `204588d` | AI-1 finish | Medium bot + partner cooperation + dispatcher. `lib/ai/coop.ts` exposes `decidePartnerCoop()` (3 advice kinds: `defer`/`cover`/`compete`) and `rankByCoop()` that filters legal plays by advice (defer drops bombs + jokerBombs, cover drops jokerBombs only, compete sorts by cost ascending). `lib/ai/medium.ts` is the Medium tier: same enumerate foundation as Easy but no random noise — always picks cheapest legal beat in current coop mode, with endgame-trumps-deference (going-out > deferring to partner because +3 levels from a double-down beat one deferral). `lib/ai/dispatch.ts` is a single `computeBotMove(ctx)` entry point that maps `tier: 'easy' \| 'medium' \| 'hard'` to the right strategy; hard throws synchronously so callers route through the async LLM client. 19 new tests. |
| `e194a80` | AI-2 | Hard tier LLM bot via Vercel AI Gateway + budget guardrail. `lib/ai/prompts/hard.zh.{md,ts}` — canonical bilingual prompt (system rules + user-prompt template + parse contract); `.md` is the human-readable source, `.ts` exports `HARD_SYSTEM_PROMPT` + `buildUserPrompt(ctx)`. `lib/ai/budget.ts` — monthly LLM spend tracker with two-tier limits (soft $50 → degrade to Medium, hard $100 → refuse record). `BudgetClient` is injectable; `createMemoryBudgetClient()` for tests/dev, `createUpstashBudget()` lands with the deploy commit. `lib/ai/hard.ts` — `chooseHardMove(ctx)` orchestrator with 5 silent-fallback triggers (FEATURE_AI_HARD env off, budget exhausted, generate threw, response unparseable, LLM index out of range). The model call is dependency-injected via `ctx.generate` so the caller wires the Vercel AI Gateway client (`"provider/model"` string like `'deepseek/deepseek-chat'`) and tests mock without spinning up the SDK. `parseLLMChoice` accepts `选择: 2` / `Choice: 2` / `选择: 过` / `选择: pass`. 20 new tests (parse ×6, chooseHardMove ×8 incl. happy path + every fallback + cost recording, budget ×6). |

**Stats**: **768/768 tests passing** (up from 676; +92 new tests across UI components, orientation hook, GameTable4P reducer, coop primitives, Medium bot, dispatcher, LLM Hard bot, budget). TS strict clean. grep-no-leak gate green. 4 commits pushed.

### 2026-05-18 — UI-3/4/5/6 + bot-dispatch session (6 commits)

| Commit | Milestone | What |
|---|---|---|
| `1918dc1`→`360b985` | (range) | This session shipped all four remaining UI tracks plus the in-handler bot run-loop. |
| (within range) | UI-3 | `src/screens/{Landing,CreateRoom,Waiting}.tsx` + `src/lib/{api/rooms,identity,router}.ts` + `src/styles/screens.css`. Hash router (`#/`, `#/create`, `#/wait?code=`, `#/table?code=`) replaces the legacy `#table=` direct-launch (still supported). Landing: brand mark + sign-in modal + join-code modal + recent-rooms list from localStorage credentials. CreateRoom: segmented 4/6/8 mode picker + AI tier chips + 6 rule toggles + spec preview. Waiting: polls `GET /api/room/[code]` every 3s, host start button gated on full+phase=lobby, auto-navigates to `#/table?code=` on phase=in_game. Typed `rooms.ts` API client with `RoomApiError`. 57 new tests. |
| (within range) | Bot dispatch | `lib/ai/runBots.ts` — synchronous run-loop with iteration cap (default 64). After human's move applies, while next player is a bot (`RoomMember.status==='bot'`, tier from `.difficulty`), `computeBotMove` + `playCards`/`pass` + `deriveMoveEvent` until landing on a human or `phase==='finished'`. Also calls `startTrick` between tricks (closes a latent gap where the move handler never started the next trick). `lib/api/move.ts` wires `runBots` after the initial deriveMoveEvent; round-end fanout now operates on `advancedRound` (post-bots). Hard tier maps to medium fallback for now — async LLM path lands when AI-2 wires through the move handler. 8 new tests. |
| (within range) | UI-4 | `src/screens/TributeModal.tsx` covers all 4 tribute substates per demos S04/S11/S12/S13: `auto` (server-picked card with CSS-transform loser→winner travel), `pending` (player-pick mode tap-to-select), `anti-tribute` (gold 抗贡 banner with double-red-joker exhibit), `return-pending` (winner picks ≤10 to return). Pure props — wires up when TRIBUTE-1 puts TributeRequiredEvent/AntiTributeEvent on the wire. 10 new tests. |
| (within range) | UI-5 | `src/components/LevelLadder.tsx` (13-rung 2→A) + `src/screens/{RoundEnd,ALevelFinal,Victory}.tsx`. RoundEnd shows headline+ladder+detail strip per S06. ALevelFinal wraps children in warm-red tinted container + pinned banner with strict-mode A-fail counter (S07). Victory: gold-tinted 胜 rune + winning roster + optional MVP + share/return CTAs. 18 new tests across 4 components. |
| (within range) | UI-6 | `src/lib/seating.ts` — pure clock-position math (5 seats for 6P, 7 for 8P, partner placed at 12 o'clock via N/2 offset). `src/screens/GameTableMP.tsx` — shared 6P/8P table with reused SSE + reducer pattern from GameTable4P, oval-felt + clock-positioned opponent seats with 4-team ring color classes (A/B/C/D). `src/App.tsx` adds `TableSwitch` wrapper that fetches the room once to dispatch to GameTable4P (mode='4') or GameTableMP (mode='6'/'8'). 19 new tests. |
| `360b985` | test fixture | Widened SnapshotEvent test cast through `unknown` so `vite build`'s strict tsc accepts the partial fixture; runtime reducer still only reads the fields actually populated. |

**Stats**: **880/880 tests passing** (up from 768; +112 new tests across rooms API client, identity, router, Landing/CreateRoom/Waiting, runBots, TributeModal, LevelLadder, RoundEnd, ALevelFinal, Victory, seating, GameTableMP reducer). TS strict clean. `pnpm build` succeeds: 41 modules → 233kB JS / 41kB CSS (gzip 72kB + 8.5kB). grep-no-leak gate green. 6 commits pushed.

**Visual smoke** (iPhone 14 Pro landscape via chrome-devtools-mcp): Landing first-paint (sign-in modal auto-open), Landing populated state (handle persisted + recent rooms list), CreateRoom (segmented picker + AI tier chips + rule toggles + spec preview) — all match demos S01/S02 contracts.

**License decision (CORE-1 part 2)**: Ported semantics from the in-repo `docs/research/game-rules.md` spec. No source code copied from `hash-panda/guandan-guide`. `// SYNC:` pins reference spec sections, not external code.

### 2026-05-18 — bot-fill + TRIBUTE-1 + Hard async session (3 commits)

| Commit | Milestone | What |
|---|---|---|
| `8d5142c` | Bot-fill at game-start | `lib/room/lifecycle.ts addBotToRoom` (pure transition with status='bot' + difficulty) + `lib/api/createRoom.ts` accepts `bots: [{tier}]` in body with per-room unique-handle picker + `lib/api/startGame.ts` runs bots after deal-event publish (defensive — fires when seats[0] is bot; canonical case host-leads is a no-op) + client `src/lib/api/rooms.ts createRoom` accepts `bots?: BotSeat[]` + `src/screens/CreateRoom.tsx` submit() converts aiTiers chip state to bots[] (filters 'human') + `src/screens/Waiting.tsx` renders bot rows with tier-emoji avatar + 'AI · 入门/进阶/高手' chip. 18 new tests across lifecycle (+7), createRoom (+9), startGame (+2). |
| `52ea2d3` | TRIBUTE-1 part D | `lib/game/nextRound.ts dealNextRound` composes shuffle → deal → tribute detection → applyTribute → startTrick into one pure step (4P runs tribute; 6P/8P skips per spec). `lib/realtime/deriveTributeEvents.ts` produces tribute_pending (with per-recipient owedCard via privatePayloads) + tribute_resolved (single/double exchanges) or just tribute_pending(direction='anti_tribute') for resist. `lib/api/move.ts` wires the helpers after round_end fanout when session continues, threading the right gameState per event side of the cross-round boundary (events emitted BEFORE dealNextRound use OLD round's gameState; events emitted AFTER use NEW round's state — closes a leak-detector false-positive on cards the new shuffle happens to redeal). `buildClientPayload.ts assertNoOpponentHandLeak` whitelist for tribute_pending + tribute_resolved (semantically public by game rules). Manual `tribute_select` / `anti_tribute` commands still return invalid_move; AUTO path only. 13 new tests across nextRound (+7), deriveTributeEvents (+5), move integration (+1). |
| `133ed0f` | Hard tier async | New `runBotsAsync` alongside sync `runBots`. Routes Hard tier through `computeBotMoveAsync` → `chooseHardMove` with injected `generate` fn (Vercel AI Gateway in prod). Silent fallback to Medium when generate omitted or any of 5 hard.ts triggers fire (FEATURE_AI_HARD off, budget exhausted, throws, unparseable, index OOB). `move.ts` + `startGame.ts` MoveDeps/StartGameDeps gain optional `generate` + `budget` fields, threaded through to runBotsAsync. Sync `runBots` retained for existing callers. 11 new tests across runBotsAsync (+6) and computeBotMoveAsync (+5). |

**Stats**: **922/922 tests passing** (up from 880; +42 new tests). TS strict clean. `pnpm build` green. grep-no-leak gate green. 3 commits pushed to `origin/main` (range `874a0fd..133ed0f`).

**Outstanding work**:
- **AUTH-2** — sibling scorer key migration `player:*` → `gs:*`. **CRITICAL DECISION TRIGGER — touches production sibling KV. Requires explicit go-ahead.**
- **TRIBUTE-1 part E (manual)** — `tribute_select` + `anti_tribute` commands still return `invalid_move` from handleMoveCommand. The S11/S12/S13 modal substates (manual loser pick + resist banner + winner return pick) need server-side state for "tribute pending player input" + idempotent command dispatch. AUTO path covers single/double/resist with server-picked cards as of `52ea2d3`.
- **Production Vercel AI Gateway wiring** — `lib/api/move.ts` + `lib/api/startGame.ts` accept `generate` + `budget` deps. The Vercel route wrappers (`api/room/[code]/move.ts` + `api/room/[code]/start.ts`) need to inject a real generate fn (e.g., `generateText({ model: 'deepseek/deepseek-chat', ... })` via @ai-sdk surface). Without wiring, Hard tier silently degrades to Medium (correct fallback).
- **`createUpstashBudget()`** — Memory budget client ships in `lib/ai/budget.ts`; the Upstash-backed variant (single `ai:budget:<YYYY-MM>` key) lands with the deploy commit so the soft/hard caps survive process restarts.
- **WASM solver** — Bobgy `poker-guandan-strategy` C++ → Emscripten port deferred. Medium currently uses pure heuristic ranking via `rankByCoop`; swapping in the WASM solver requires only changing the final `pickCheapest` call (no dispatch-surface change). Estimated 7-10 days when the port becomes a priority.

**Auth note for CRON-1 deploy**: set `ADMIN_TOKEN` (or `CRON_SECRET`) in Vercel project env vars before the first cron fires; absent it the endpoint returns 503 fail-closed.

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
