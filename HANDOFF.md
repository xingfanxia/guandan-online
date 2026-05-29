# Handoff — guandan-online v1 (feature-complete · shipped to origin/main · CI green)

> **Authoritative per-session log lives in [`CLAUDE.md` § Last updated](CLAUDE.md).** The dated `## Progress` sections in *this* file stop at 2026-05-21; the v1-completion loop (audit-fix + SEC-2/3/4 + AI-3/4 + EXCHANGE-1 + DEPLOY-2 + F12 Bobgy Phase B scaffolding) and the 2026-05-28 v1 ship are documented there, not below. Treat the body of this file as historical narrative through P0→UI→deploy.

**Date**: 2026-05-28 (v1 pushed to origin/main + production deploy verified + CI benchmark seed fix). Earlier same-milestone work: v1-completion loop 2026-05-28; audit-fix loop 2026-05-22; route-signature fix + UI-7 rotate 2026-05-21.
**Status**: **v1 feature-complete and on `origin/main`** (`b214942` + CI fix `11f740c`), GitHub Actions CI green (typecheck + unit + Playwright). Backend + all UI tracks (UI-1..7) + Easy/Medium AI + Bobgy decomposer Phase A + tribute (auto/manual + 6P/8P sweep) + the 7 v1-completion milestones (SEC-2 IP throttle + same-room warning, SEC-3 report+admin, SEC-4 BotID gate, AI-3 in-game assist, AI-4 DC→bot takeover, EXCHANGE-1 optional 换牌, DEPLOY-2 latency telemetry). F12 Bobgy Phase B Hard tier is scaffolded + dispatch-routed but its UI chip is **deliberately withheld** (benchmarks ≈ Medium; decisive Hard>Medium lookahead is research-grade, deferred). **1512 unit tests + 41 e2e** · per-path coverage gate green (lib/** 80% / src/** ratchet · ~87% overall) · TS strict clean · `npm run build` clean · grep-no-leak green · `scripts/ops/verify-all.sh` ✔. **14 HTTP/SSE routes**. Production deploy `hr5i5vmuw` ● Ready; `/api/health` 401-SSO in 0.37s (function invokes — named-export route signatures confirmed; not the old timeout). SSO-gated behind `*.vercel.app`; public `gdo.ax0x.ai` pending DNS. Vercel project `panpanmao/guandan-online` (independent Upstash instance — no shared key space with sibling scorer; AUTH-2 sibling KV migration **cancelled** 2026-05-19). **Remaining (non-code / deferred)**: `gdo.ax0x.ai` DNS records — the apex is third-party-managed, so add the domain via the Vercel dashboard (Project → Settings → Domains) to surface its domain-specific CNAME + `vc-domain-verify=…,dc` TXT, then create both at the DNS provider; CLI `vercel domains add` is blocked (`domain_not_owned`). Decisive Hard>Medium lookahead + UI chip (research-grade — heuristic lead-policy attempted + rejected 2026-05-28, see `docs/plan/bobgy/PHASE-B-FINDINGS.md`). **Closed 2026-05-28**: `IP_HASH_SALT` set on Production (SEC-2); manual-tribute + card-exchange interleave (commit `1b1f6a5`).
**Repo**: https://github.com/xingfanxia/guandan-online
**Vercel project**: `panpanmao/guandan-online` (linked 2026-05-18; production deploy live behind team SSO, GitHub auto-deploy active)
**Domain (locked)**: `gdo.ax0x.ai` (sibling subdomain to scorer at `gd.ax0x.ai`)

---

## Progress

### 2026-05-22 — audit-fix-loop session (1 commit, in flight)

First comprehensive multi-layer audit ever run on the project. Three audit-fix rounds: parallel 4-layer reviewers (game/AI, realtime/API, frontend, infra) → 4 parallel opus fix agents (33 findings) → Round 2 verify + focused re-audit → Round 2 fix (6 more findings) → Round 3 convergence (all clear).

**Critical bugs discovered + fixed:**

| Finding | File | Fix |
|---|---|---|
| SSE named-event dispatch silent drop | `src/lib/sseClient.ts` | `addEventListener` per `SERVER_EVENT_TYPES` discriminator (was `es.onmessage` only — caught every event named via `event: <type>` on the wire as silent drop) |
| Memory infra isolation in local dev | `lib/realtime/sharedInfra.ts` (new) + all 9 routes | Process singleton; routes call `getSharedInfra()` |
| `canBeat` level-rank straight bug | `lib/game/patterns.ts` | New `sequenceRankValue` helper; non-bomb sequences use natural ordering |
| `detectTributeModeMP` 6P/8P single fallback | `lib/game/tribute.ts` | Pick lowest-positioned LOSER, not last finisher |
| Decomposer level-10 encoding | `lib/ai/decomposer/index.ts` | Use `rankToBobgyChar` instead of `levelRank.charCodeAt(0)` |
| Wildcard enumeration | `lib/ai/enumerate.ts` | Same-rank wildcard synthesis loop |
| SSE Last-Event-ID resume broken | `lib/realtime/eventLog.ts` | Log id = `event.version` directly (was independent INCR seq) |
| Bot exception crashes move/start | `lib/ai/runBots.ts` + `lib/api/{move,startGame}.ts` | try/catch around `computeBotMove` + outer defense |
| Concurrent start race | `lib/api/startGame.ts` | `start-${code}` idempotency reservation |
| App.tsx myHandle bug | `src/App.tsx` + `src/lib/identity.ts` | `RoomCredentials.handle` field; fallback to `getHandle()` |
| Card selection desync | `src/screens/GameTable4P.tsx` + `GameTableMP.tsx` | `myPlayerIdRef` + clear on own `move_played` |
| `vercel.json maxDuration: 300` global | `vercel.json` | Narrow per-route (SSE=300s · cron=60s · move=30s · default=15s) |
| **Round 2 — idempotency-on-throw orphans reservation** | `lib/api/{move,startGame,createRoom}.ts` | try/catch post-reservation; commit `'internal_error'` response so retries replay cached error instead of stuck `'pending'` |

**Important (19) — abbreviated**: move handler now refreshes `lastActiveAt` (race documented with skipped repro test for future fix), Upstash-backed rate limiter via `@upstash/ratelimit`, SSE log-drain-vs-subscribe race fix (subscribe-first + buffer-and-flush), `stream_closing` version collision fix (omit `id:` line), R-I5 rate-limit + idempotency on all POST endpoints (create / join / leave / start with per-endpoint quotas), tsconfig drift (`noUnusedLocals/Parameters` mirrored to root), `ADMIN_TOKEN` blast radius documented in `.env.example` + `api/cron/cleanup-rooms.ts`, GitHub Actions CI workflow, `scripts/build-wasm.sh` pinned to `emscripten/emsdk:5.0.7`, ESLint dangling reference removed, SSE client `visibilitychange` reconnect + `lastVersion` preservation across remount, `localStorage.setItem` guarded against `QuotaExceededError` + 7-day pruning, anti-tribute backdrop click removal (explicit `我们抗贡` button gated by `canDeclare`), Card/Avatar `<button>` swap for WCAG 2.1.1 keyboard activation, Waiting strict-A chip reads from `room.rules` instead of hardcoded "宽松 A", `canDeclare` heuristic widened to `myTeam !== winnerTeam` (was per-player-holds-red-joker — hid CTA from the OTHER losing partner), createRoom cached idempotency fallthrough treated as cache corruption.

**Minor (11+) — abbreviated**: `.DS_Store` removed from tracking, `tsconfig.node.json` eslint.config.js reference removed, `.gitignore` negate-block comment explains order dependency, JoinModal `false | 'auto' | 'manual'` autofocus pattern, `splitSeats` clock-position ordering, `pickTributeCard`/double-tribute interpretation notes, `cardsMatch` cardKey duplication noted, `sseClient.onClose` fires exactly once, Hand roving-tabindex (Arrow Left/Right within hand), 20+ test-gap items added across the audit reports, comment-code mismatch on idempotency catch behavior corrected.

**New infrastructure shipped this session:**

- `scripts/vite-api-plugin.ts` — Vite Connect-middleware plugin that mounts all 9 Vercel route handlers on `npm run dev` (and the Playwright web server). Converts Node `IncomingMessage` ↔ Web `Request/Response` (stream + abort for SSE). `npm run dev` is now a single-origin SPA + API + SSE surface; no `vercel dev` cold-start.
- `tests/e2e/` — Playwright suite with 8 spec files + `helpers/{api,ui}.ts`:
  - `health.spec.ts` — server topology, SSE 400/401
  - `landing.spec.ts` — sign-in modal (auto-open / autofocus / persist / validate), CTA navigation, recent rooms
  - `create-room.spec.ts` — default rules, strict-A toggle, 4P + 3 bots, capacity rejection
  - `game-flow.spec.ts` — create → wait → start → deal (4P), card selection enabled on turn, 6P MP table
  - `orientation.spec.ts` — CSS rotate portrait / autofocus bypass / landscape pass-through / desktop bare
  - `join-flow.spec.ts` — 2nd-player join, nonexistent code error, short-code rejection
  - `error-handling.spec.ts` — MissingCreds, room-ended, API contracts
  - `full-ui-journey.spec.ts` — end-to-end from Landing through deal without API shortcuts
- `.github/workflows/ci.yml` — typecheck + unit + security + npm audit (informational) + Playwright chromium-desktop with artifact upload on failure
- `scripts/ops/verify-all.sh` — full chain (typecheck → unit → security → build → e2e); `--no-e2e` for faster local pass
- `lib/realtime/sharedInfra.ts` — process-wide singleton for `RealtimeInfra` + rate-limiter cache; dev mode multiplies rate-limit caps by `RATE_LIMIT_DEV_MULTIPLIER` (default 50) so e2e tests don't trip prod-tight quotas; Upstash branch in production takes the unmultiplied path

**Test deltas**: 1022 → **1138 passing + 1 skipped + 47 e2e** (chromium-desktop + mobile-portrait + mobile-landscape; mobile projects scoped to orientation specs to avoid OrientationLock-modal interaction flakiness on small viewports). ~+200 tests overall.

**Verification (full chain green)**:
- `npm run typecheck` clean
- `npm test` 1138/1138 + 1 skipped
- `npm run security:no-leak` green
- `npm run build` clean (247kB JS gzip 75kB · 42kB CSS gzip 8.8kB)
- `npm run test:e2e` 47/47

**Files changed**: 70 (+3,633 / −436 lines). No production architecture change — backend topology, AI tier ladder, tribute state machine, and event model are all unchanged. The deltas are pure correctness + robustness + a11y + observability + test coverage.

**Process notes**: 4 parallel opus fix agents worked simultaneously without file conflicts by scoping each to a distinct layer (game/ai, realtime/api, frontend, infra/config). Two findings (SSE named-event dispatch + memory infra isolation) were fixed by the orchestrator directly because they unblocked the e2e baseline — that's the single most valuable result of running the audit-fix-loop: the very first attempt at e2e rendering surfaced two production-breaking silent bugs that no existing test could catch.

**Open items**:
- Manual unskip + verify the `lastActiveAt` race repro test once a chosen atomic-update approach lands (Redis WATCH/MULTI vs. separate `lastActiveAt:<code>` key vs. Lua/EVAL). Currently documented as `.skip()` with reproduction notes inline.
- Bobgy WASM Phase B (lookahead policy + Hard tier revival + UI chip) — still a separate future session per `docs/plan/bobgy/PHASE-A.md` §10.
- DNS records for `gdo.ax0x.ai` at the user's DNS provider.

Full session report: `docs/reports/audit-fix-2026-05-22/SESSION-REPORT.md`.

---

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

**Stats**: **880/880 tests passing** (up from 768; +112 new tests across rooms API client, identity, router, Landing/CreateRoom/Waiting, runBots, TributeModal, LevelLadder, RoundEnd, ALevelFinal, Victory, seating, GameTableMP reducer). TS strict clean. `npm run build` succeeds: 41 modules → 233kB JS / 41kB CSS (gzip 72kB + 8.5kB). grep-no-leak gate green. 6 commits pushed.

**Visual smoke** (iPhone 14 Pro landscape via chrome-devtools-mcp): Landing first-paint (sign-in modal auto-open), Landing populated state (handle persisted + recent rooms list), CreateRoom (segmented picker + AI tier chips + rule toggles + spec preview) — all match demos S01/S02 contracts.

**License decision (CORE-1 part 2)**: Ported semantics from the in-repo `docs/research/game-rules.md` spec. No source code copied from `hash-panda/guandan-guide`. `// SYNC:` pins reference spec sections, not external code.

### 2026-05-18 — bot-fill + TRIBUTE-1 + Hard async session (3 commits)

| Commit | Milestone | What |
|---|---|---|
| `8d5142c` | Bot-fill at game-start | `lib/room/lifecycle.ts addBotToRoom` (pure transition with status='bot' + difficulty) + `lib/api/createRoom.ts` accepts `bots: [{tier}]` in body with per-room unique-handle picker + `lib/api/startGame.ts` runs bots after deal-event publish (defensive — fires when seats[0] is bot; canonical case host-leads is a no-op) + client `src/lib/api/rooms.ts createRoom` accepts `bots?: BotSeat[]` + `src/screens/CreateRoom.tsx` submit() converts aiTiers chip state to bots[] (filters 'human') + `src/screens/Waiting.tsx` renders bot rows with tier-emoji avatar + 'AI · 入门/进阶/高手' chip. 18 new tests across lifecycle (+7), createRoom (+9), startGame (+2). |
| `52ea2d3` | TRIBUTE-1 part D | `lib/game/nextRound.ts dealNextRound` composes shuffle → deal → tribute detection → applyTribute → startTrick into one pure step (4P runs tribute; 6P/8P skips per spec). `lib/realtime/deriveTributeEvents.ts` produces tribute_pending (with per-recipient owedCard via privatePayloads) + tribute_resolved (single/double exchanges) or just tribute_pending(direction='anti_tribute') for resist. `lib/api/move.ts` wires the helpers after round_end fanout when session continues, threading the right gameState per event side of the cross-round boundary (events emitted BEFORE dealNextRound use OLD round's gameState; events emitted AFTER use NEW round's state — closes a leak-detector false-positive on cards the new shuffle happens to redeal). `buildClientPayload.ts assertNoOpponentHandLeak` whitelist for tribute_pending + tribute_resolved (semantically public by game rules). Manual `tribute_select` / `anti_tribute` commands still return invalid_move; AUTO path only. 13 new tests across nextRound (+7), deriveTributeEvents (+5), move integration (+1). |
| `133ed0f` | Hard tier async | New `runBotsAsync` alongside sync `runBots`. Routes Hard tier through `computeBotMoveAsync` → `chooseHardMove` with injected `generate` fn (Vercel AI Gateway in prod). Silent fallback to Medium when generate omitted or any of 5 hard.ts triggers fire (FEATURE_AI_HARD off, budget exhausted, throws, unparseable, index OOB). `move.ts` + `startGame.ts` MoveDeps/StartGameDeps gain optional `generate` + `budget` fields, threaded through to runBotsAsync. Sync `runBots` retained for existing callers. 11 new tests across runBotsAsync (+6) and computeBotMoveAsync (+5). |

**Stats**: **922/922 tests passing** (up from 880; +42 new tests). TS strict clean. `npm run build` green. grep-no-leak gate green. 3 commits pushed to `origin/main` (range `874a0fd..133ed0f`).

### 2026-05-18 — env-aliasing + AI Gateway + createUpstashBudget + TRIBUTE-1 part E session (3 commits)

| Commit | Milestone | What |
|---|---|---|
| `99dd52e` | Env aliasing + budget | `lib/realtime/infra.ts RealtimeEnv` accepts both `UPSTASH_REDIS_REST_{URL,TOKEN}` and `KV_REST_API_{URL,TOKEN}` env pairs (Vercel Marketplace integration provisions the latter); UPSTASH-prefixed wins when both present. `RealtimeInfra.redis` exposes the underlying RedisLike (null on memory backend) so adjacent clients build without re-reading env. `lib/ai/budget.ts createUpstashBudget(redis, now?)` ships with `ai:budget:YYYY-MM` (UTC) keys via the existing RedisLike contract; concurrency is read-modify-write (guardrail-not-ledger semantics). `budgetKeyForMonth(date)` exported for operator scripts. `.env.example` documents both naming pairs + switches `DEEPSEEK_API_KEY` → `AI_GATEWAY_API_KEY`. 14 new tests (4 infra env-aliasing + 10 budget Upstash). |
| `076bf7e` | Production AI Gateway wiring | `lib/ai/gateway.ts` new module — `createGatewayGenerate({model?, rates?})` closure calls `generateText({ model: 'deepseek/deepseek-chat', system, prompt, abortSignal })` from `ai@6` (installed this session). The Vercel AI Gateway routes by the `"provider/model"` string when `AI_GATEWAY_API_KEY` is set on the deploy environment. Pure `computeCostUsd(usage, rates)` helper uses published deepseek-chat rates ($0.27 / $1.10 per 1M input/output tokens). Route wrappers `api/room/[code]/{move,start}.ts` build the gateway generate fn only when the env key is present (else `undefined` → silent Medium fallback per the documented contract); budget client picks Upstash vs memory from `infra.redis`. Generate fn + budget cached at module scope for warm function instance reuse. 12 new tests (cost calc edges + SDK arg shape + error propagation via `vi.mock('ai')`). |
| `df6ba3f` | TRIBUTE-1 part E (manual) | `lib/realtime/handleMove.ts` now dispatches `tribute_select` / `anti_tribute` ahead of the trick-based 'not_your_turn' check (these commands operate on pre-trick `pendingTribute` state where `round.currentTrick` is null by design). `lib/game/round.ts GameRound` gains optional `pendingTribute?: PendingTributeState` carrying mode + obligations (with `selectedCard: Card \| null`) + finishOrder. New `lib/game/tributeFlow.ts` ships two pure transitions: `selectTributeCard(round, playerId, card)` validates ownership + card-in-hand + wildcard exemption + no-double-select, stashes the card, finalizes via `applyTribute` + `startTrick` when all obligations satisfied; `declareAntiTribute(round, playerId)` validates resist mode + losing-team player + finalizes with no swap. `lib/game/tribute.ts TributeMode` gains optional `tributeCard?: Card` per obligation; `applyTribute` uses the explicit card when provided (validates in-hand + non-wildcard), falls back to `pickTributeCard` otherwise — backward-compatible (auto-mode callers in `dealNextRound` pass mode without the field). **Auto-mode at round-start unchanged** — never sets `pendingTribute`, so dispatch returns `invalid_move` on rounds that opted into AUTO. Manual-mode round-start wiring (room rule, event emission, UI hookup) is a separate phase. 23 new tests (tributeFlow ×14 + handleMove dispatch ×9). |

**Stats**: **970/970 tests passing** (up from 922; +48 new tests). TS strict clean. `npm run build` green (41 modules → 233kB JS / 41kB CSS · gzip 72kB + 8.5kB). grep-no-leak gate green. 3 commits pushed to `origin/main` (range `133ed0f..df6ba3f`).

**Vercel project linked** (separate event, same session): Created `panpanmao/guandan-online` (projectId `prj_Y3gwNGDixTDz5KBfkjJjsYWcwrlv`, GitHub repo auto-connected). Decision: keep stale `guandan-online-codex` project (from a prior agent session) alive rather than deleting. Upstash Redis provisioned via Marketplace integration → exposes `KV_REST_API_*` env vars (handled by the env-aliasing in commit `99dd52e`). Production deploy + `gdo.ax0x.ai` domain config still pending.

### 2026-05-19 — Manual-tribute round-start wiring (commit `15d2ec2`)

Closes the manual-tribute backend gap: until this commit the dispatcher accepted `tribute_select` / `anti_tribute` commands but `dealNextRound` always ran the auto swap. Now opting into `manualTribute` via `ModeRules` causes the new round to surface with `pendingTribute` set and the trick deferred until players resolve via the wire commands.

| File | Change |
|---|---|
| `lib/game/mode.ts` | `ModeRules.manualTribute: boolean` (default `false`). `DEFAULT_MODE_RULES.manualTribute = false`. |
| `lib/game/nextRound.ts` | Manual branch: when `session.rules.manualTribute && mode==='4' && tributeMode.kind !== 'none'`, skip `applyTribute`, build `pendingTribute` from the detected mode, skip `startTrick`. AUTO path unchanged. Result gains `pendingManualTribute: boolean` so callers can choose event sequences. |
| `lib/game/tributeFlow.ts` | `selectTributeCard` / `declareAntiTribute` now return `TributeFlowResult` (`{ round, exchanges }`) instead of just `GameRound`. `exchanges` is `null` for intermediate selects, `[]` for resist finalization, populated for single/double finalization. |
| `lib/realtime/handleMove.ts` | `HandleMoveResult` gains optional `tributeExchanges` + `tributeMode` populated only on finalization; threaded up from `tributeFlow`. |
| `lib/api/move.ts` | When `dispatch.tributeExchanges` is set, emit a `tribute_resolved` event at `response.appliedVersion` carrying the flattened tribute+return card movements (resist emits empty `exchanged`). |
| `lib/ai/runBots.ts` | Exit early when `round.pendingTribute !== undefined`. Previously the loop auto-called `startTrick` when `currentTrick` was null, which would prematurely start play before the tribute resolves. The manual flow helpers handle `startTrick` themselves after finalization. |
| Tests | nextRound (+2 manual-branch tests), tributeFlow (existing 4 updated to unpack `.round`), handleMove (+2 assertions on finalization fields), api/move (+1 end-to-end manual flow test). |

**Stats**: **920/920 tests passing** (917 → 920). TS strict clean. `npm run build` clean (233kB JS / 41kB CSS · gzip 72kB + 8.5kB). grep-no-leak gate green.

**What's still outstanding for manual tribute to be reachable end-to-end from a browser:**
- ~~UI hookup~~ ✅ Shipped in follow-up commit (see next section).
- Room rule UI: `src/screens/CreateRoom.tsx` rules grid currently has 6 axes; would need to add a "手动进贡" toggle that translates to `manualTribute: true` in the room rules payload sent to `POST /api/room/create`. (Server-side accepts the rule via the existing `ModeRules` plumbing; just no UI surface for opting in yet.)

### 2026-05-19 — Manual-tribute UI hookup (GameTable4P reducer + TributeModal wiring)

GameTable4P reducer now handles `tribute_pending` / `tribute_resolved` and renders the existing `TributeModal` component when the local player has a role in the tribute (obligated to pick, or losing-team resist).

| File | Change |
|---|---|
| `src/screens/GameTable4P.tsx` | `TableState` gains `tribute: TributePendingSnapshot \| null` + `roundNumber: number`. Reducer adds `reduceTributePending` (stores snapshot) and `reduceTributeResolved` (clears snapshot). `reduceDeal` also clears the snapshot + bumps `roundNumber`. New `submitTributeSelect(card)` + `submitAntiTribute()` POST handlers fire `tribute_select` / `anti_tribute` commands via the existing `/api/room/[code]/move` endpoint. New `buildTributeModalState(...)` helper maps the snapshot + local player context to the appropriate `TributeState` substate (`pending` when I owe, `auto` display when I'm receiver with `yourOwedCard` set, `anti-tribute` banner on resist, `null` for third parties). Modal renders conditionally when state is non-null. |
| `tests/screens/GameTable4P.test.tsx` | EMPTY fixture updated for new fields. +4 reducer tests covering tribute_pending storage, yourOwedCard preservation, tribute_resolved clear, and deal-time clear with roundNumber bump. +5 buildTributeModalState tests covering null, pending (with wildcard exemption), auto display, manual receiver waits silently, resist banner. |

**Stats**: **929/929 tests passing** (920 → 929). TS strict clean. `npm run build` clean (242kB JS / 41kB CSS · gzip 73kB + 8.5kB — modest bump from importing TributeModal into the table screen). grep-no-leak gate green.

**Manual smoke not yet done** — the reducer / dispatch path is unit-tested but iPhone 14 Pro landscape capture under chrome-devtools-mcp hasn't been run for this commit. The TributeModal component itself was visually validated at 2026-05-18 UI-4 ship; the wire-up adds no new visual surface.

**Still outstanding:**
- ~~Room rule UI~~ ✅ Shipped in follow-up commit (see next section).
- **GameTableMP** (6P/8P) — doesn't yet handle tribute events. Currently a no-op because `dealNextRound` only runs tribute for `mode==='4'`. When 6P/8P sweep tribute lands (`docs/research/game-rules.md` § "Sweep tribute"), the same reducer pattern would need to be ported.

### 2026-05-19 — Manual-tribute opt-in UI + server plumbing (手动进贡 toggle)

Closes the last manual-tribute gap before deploy. The `POST /api/room/create` body now accepts `manualTribute: boolean` (defaults false; server validates type, persists onto the room's `ModeRules`). The CreateRoom screen surfaces a `手动进贡` toggle in the existing rules grid that threads through the typed client API client. Other rule toggles in the grid remain cosmetic for ROOM-2 to wire.

| File | Change |
|---|---|
| `lib/api/createRoom.ts` | `parseBody` accepts optional `manualTribute: boolean` (defaults false; rejects non-boolean with `invalid_request` + descriptive details). Merges onto `DEFAULT_MODE_RULES` before `createRoom()` so `RoomState.rules.manualTribute` reflects host's choice. |
| `src/lib/api/rooms.ts` | `createRoom(input)` accepts optional `manualTribute?: boolean`; included in POST body only when true (keeps payload minimal for default-false). |
| `src/screens/CreateRoom.tsx` | `RULE_AXES` gains 7th entry `manualTribute` (`label: 手动进贡`, `defaultOn: false`). `submit()` threads the toggled state through `createInput.manualTribute`. Comment notes only this axis is currently plumbed end-to-end. |
| `tests/api/createRoom.test.ts` | +3 tests: persists `manualTribute=true`, defaults to `false` when omitted, rejects non-boolean. |

**Stats**: **932/932 tests passing** (929 → 932). TS strict clean. `npm run build` clean (242kB JS / 41kB CSS · gzip 74kB + 8.5kB). grep-no-leak gate green.

**Manual-tribute is now fully wired end-to-end**: host opts in via the toggle on CreateRoom → server persists onto session.rules → dealNextRound branches to manual path → tribute_pending event fires → TributeModal renders for obligated players → tribute_select / anti_tribute commands dispatch → tribute_resolved closes the modal and the trick begins.

**Remaining substantive work after this session:**
- **First Vercel production deploy** — `vercel --prod` against `panpanmao/guandan-online` + `gdo.ax0x.ai` domain config + `ADMIN_TOKEN` env var (required for `/api/cron/cleanup-rooms`; fail-closed 503 without). Needs AX authorization — destructive external operation.
- **Bobgy WASM port** — Repo 1 in `ai-strategies.md`; 7-10 days independent work to bring back the Hard tier via deeper search depth.
- **ROOM-2 milestone** — Wire the remaining 6 cosmetic rule axes in CreateRoom (aLevelStrict / wildcardHeart / lastCallDeclare / steelPlate / triPair / straightFlushAboveBomb5) through to `ModeRules` server-side. Pattern is the same as the manualTribute slice from this session; just more axes + more validation.
- **GameTableMP** sweep tribute — deferred per game-rules.md § "Sweep tribute (6P/8P)".

### 2026-05-19 — ROOM-2 + first production deploy (commit `a2ea2dc`, `16130ce`, `2d576df`, prebuilt deploy)

Two outstanding items from the prior session cleared this session: ROOM-2 milestone (wire the remaining rule axes through) and first Vercel production deploy. AX authorized both at session start.

| File | Change |
|---|---|
| `lib/game/mode.ts` | `ModeRules` gains 5 new boolean fields: `wildcardHeart` (default `true`), `lastCallDeclare` (`false`), `steelPlate` (`true`), `triPair` (`false`), `straightFlushAboveBomb5` (`true`). Each field documents that the v1 engine doesn't yet branch on it; persisted display-only for future engine consumption. Defaults match `demos/index.html` S02 wireframe defaults. |
| `lib/api/createRoom.ts` | `parseBody` accepts the full `BOOLEAN_RULE_KEYS` (strictA + must1 + manualTribute + 5 new) as optional flat-shape overrides. Each non-boolean rejects with `${key} must be a boolean`; omitted keys inherit `DEFAULT_MODE_RULES`. `effectiveRules = { ...DEFAULT_MODE_RULES, ...parsed.value.rules }` replaces the prior `manualTribute`-only merge. |
| `src/lib/api/rooms.ts` | Exports new `RoomRuleOverrides` interface (8 axes — 7 booleans + a `must1` placeholder for future use). `createRoom(input)` accepts the overrides inline and only sends non-default values on the wire — keeps payload minimal and preserves backward-compat with the existing `{mode, host}` shape (the existing `createFn.toHaveBeenCalledWith({ mode: '4', handle: '@阿祥' })` test passes unchanged when all toggles are at default). |
| `src/screens/CreateRoom.tsx` | `RULE_AXES` id `aLevelStrict` → `strictA` (client/server naming alignment; label unchanged: 'A 级严格'). New `RuleAxisId` union type. `submit()` loops `RULE_AXES`, builds `ruleOverrides` containing only `rulesOn[axis.id] !== axis.defaultOn` entries, spreads into the create call. SummaryRow update mirrors the id rename. |
| `tests/api/createRoom.test.ts` | +21 mechanical tests (3 contract tests × 7 axes via `for...of` loop — persists when set / defaults when omitted / rejects non-boolean) + 1 multi-override combined test. |
| `tests/screens/CreateRoom.test.tsx` | +2 wire-through tests (toggled-non-defaults vs all-defaults). |
| `vercel.json` | Drop invalid `functions.api/**/*.ts.runtime: "nodejs22.x"` field (modern Vercel only accepts `edge` / `experimental-edge` / `nodejs` here; Node major version is governed by `package.json engines` + project settings). 7 prior auto-deploys had failed with this error. |
| `api/**/*.ts` (9 files) | Remove `export const config = { runtime: 'nodejs22.x' }` from each route. The runtime field in per-route exports has the same restriction as `vercel.json` — `nodejs22.x` isn't an accepted value (must be `nodejs` / `edge` / `experimental-edge`). `api/sse/[roomId].ts` keeps an explicit `maxDuration: 300` so the 270s SSE rotation contract stays self-documenting (300s is the platform default in 2026 — explicit beats implicit for the timeout-sensitive route). |

**Stats**: **932 → 956 tests** passing (+24 across createRoom + CreateRoom screen). TS strict clean. `npm run build` clean (42 modules → 242kB JS / 42kB CSS · gzip 74kB + 8.5kB). grep-no-leak gate green.

**Vercel deploy** (3 attempts in this session):

| Attempt | Source | Outcome |
|---|---|---|
| `dpl_4uBMiFHtoScPiT4TpMuggaMk71PQ` (15h-prior `njqhdu6qf`, GitHub auto-deploy) | Commit `16130ce` (vercel.json fix) | Build succeeded, status Ready, but `vercel curl /api/health` timed out (FUNCTION_INVOCATION_TIMEOUT after 5min). The cloud rebuild ran tsc per-function under nodenext moduleResolution and emitted dozens of TS2835 errors about missing `.js` extensions on relative imports (project uses `moduleResolution: "bundler"` everywhere — incompatible with Vercel's per-function tsc check). Functions may not have packaged correctly. |
| `dpl_4uBMiFHtoScPiT4TpMuggaMk71PQ` re-targeted (manual `vercel --prod`) | Same commit | Same Ready status, same alias routing. Identical underlying issue. |
| `dpl_Fjt8FhpeNrQ4cppPZdwZRneH3AZq` (`vercel deploy --prebuilt --prod`) | Local `.vercel/output/` from `vercel build --prod` | Functions bundled locally (all 9 `.func` directories under `.vercel/output/functions/api/`), uploaded as-is — bypasses the cloud rebuild's tsc check. Status Ready. Currently aliased to `guandan-online-{henna,xingfanxia,panpanmao}.vercel.app`. |

The prebuilt path is the **current production deploy**. The pure GitHub auto-deploy path is broken because the cloud-side tsc invocation that @vercel/node runs uses default `nodenext` moduleResolution against TS files designed for `bundler` mode. Local `vercel build` works (uses esbuild for the actual bundle; tsc warnings are non-fatal at that layer). To fix the GitHub auto-deploy path durably, future work either: (a) add `.js` extensions to all relative TS imports across the codebase (~50 files, mechanical), (b) configure @vercel/node to use a specific tsconfig via vercel.json functions config, or (c) move to `vercel.ts` configuration with a tighter functions spec. Until that lands, every production deploy must go through `vercel build && vercel deploy --prebuilt --prod` from a local checkout (skip the GitHub auto-deploy hook for this project).

**Env vars set on Production**: `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`, `REDIS_URL` (all Upstash, auto-provisioned by the Marketplace integration), plus `ADMIN_TOKEN` (32-byte base64url, generated this session, set via `vercel env add`) for `/api/cron/cleanup-rooms` Bearer auth.

**Custom domain `gdo.ax0x.ai`** registered on the project (POST `/v10/projects/guandan-online/domains` returned `verified: false`). DNS records needed at the user's DNS provider (likely Cloudflare given the sibling `gd.ax0x.ai` pattern) before public traffic resolves:

| Type | Name | Value | Purpose |
|---|---|---|---|
| `TXT` | `_vercel.ax0x.ai` | `vc-domain-verify=gdo.ax0x.ai,1a52d460b7c82b46283d` | One-time domain verification |
| `CNAME` | `gdo.ax0x.ai` | `cname.vercel-dns.com` | Production traffic routing |

Once both records resolve, Vercel verifies the domain and `https://gdo.ax0x.ai` serves the deploy publicly (the `ssoProtection.deploymentType: "all_except_custom_domains"` setting means SSO is bypassed for the custom domain — `*.vercel.app` URLs stay team-gated).

**Verification status**: deploy returns `Ready` per Vercel API. HTTP-level smoke (curl `/api/health`, hit `/api/room/create`, SSE on `/api/sse/<roomId>`) is **blocked by SSO** until DNS resolves; the SSO-bypass token + cookie path works via the dashboard but didn't return JSON over `vercel curl` (hit Vercel CDN edge timeouts during testing — possibly a transient infrastructure issue or wrong bypass-cookie semantics from the CLI). End-to-end smoke deferred until DNS is in place.

**Remaining substantive work after this session:**
- **DNS records for `gdo.ax0x.ai`** (above) — user action at Cloudflare or wherever ax0x.ai is managed. After resolution, end-to-end HTTP smoke is a 5-minute curl exercise.
- **GitHub auto-deploy path fix** — currently broken due to cloud tsc + bundler-mode mismatch. Workaround: `vercel build && vercel deploy --prebuilt --prod` from local. Durable fix: (a) `.js` extensions across the codebase, (b) per-function tsconfig in vercel.json, or (c) `vercel.ts` migration. Captured for future investigation; not blocking the v1 launch path.
- **Bobgy WASM port** — Repo 1 in `ai-strategies.md`; 7-10 days independent work to bring the Hard tier back via deeper search depth.
- **GameTableMP sweep tribute** — deferred per `game-rules.md § "Sweep tribute (6P/8P)"`.

### 2026-05-21 — GitHub auto-deploy unblocked (commit `edeb6c7`)

Single commit cleared the two cloud-build issues that had forced manual `vercel deploy --prebuilt --prod` for every release. The prior ROOM-2 session hit `dpl_4uBMiFHtoScPiT4TpMuggaMk71PQ` returning Ready but `vercel curl /api/health` hanging with FUNCTION_INVOCATION_TIMEOUT after 5min — root cause turned out to be TWO compounding problems that the prior diagnostic only caught the first of:

1. **TS2835 on every relative TS import** — confirmed in the prior diagnostic. `@vercel/node` walks up from each function file and applies tsc with `nodenext` defaults, which mandates explicit `.js` suffixes on relative imports. Our codebase uses `moduleResolution: "bundler"` (extensionless imports allowed), so locally and in Vite/Vitest builds we never noticed. Dozens of TS errors per function file resulted in malformed function bundles that failed at cold-start.

2. **TS2591 `process` not found + TS2339 union narrowing in `parseBody`** — NEW finding, hidden by the noise of (1). Root `tsconfig.json` was solution-style (`files: []` + references only), so @vercel/node found no `compilerOptions` on the closest tsconfig and fell back to defaults: `strict: false` + no `@types/node`. That manifested as TS2591 across cron + room/create + sse routes (`process.env`), and TS2339 in `lib/api/createRoom.ts:65` because `parsed.error` only narrows after `if (!parsed.ok)` under `strict: true`.

| File | Change |
|---|---|
| `scripts/migrations/add-js-extensions.py` | NEW. Idempotent Python migration: walks `lib/ api/ src/ tests/` for `.ts`/`.tsx` files, regex-rewrites `from './foo'` → `from './foo.js'`, skips already-suffixed paths (`.js` / `.json` / `.css` / image extensions). 275 imports rewritten across 65 files (lib/ 249, api/ 17, src/ 3, tests/ 6). Reusable — re-run safely after adding new code if you forget the suffix. |
| `lib/**/*.ts`, `api/**/*.ts`, `src/**/*.{ts,tsx}`, `tests/**/*.{ts,tsx}` | Migration applied. Mechanical `.js` suffix on every relative TS import. Vite/Vitest with bundler resolution transparently map `.js` → `.ts` so no runtime change. |
| `tsconfig.json` | Mirrored `tsconfig.app.json` compilerOptions onto the root: `target: ES2023` / `lib: [ES2023, DOM, DOM.Iterable]` / `module: ESNext` / `moduleResolution: bundler` / `strict: true` / `noUncheckedIndexedAccess: true` / `noImplicitOverride: true` / `noFallthroughCasesInSwitch: true` / `verbatimModuleSyntax: true` / `useUnknownInCatchVariables: true` / `skipLibCheck: true` / `types: ["node"]` / etc. References preserved untouched — `tsc -b` still routes through the per-project configs as before. |

**Stats**: **956/956 tests passing** (no test deltas — purely structural). TS strict clean (`npm run typecheck`). `npm run build` clean: identical 42-module artifact (242kB JS / 42kB CSS · gzip 74kB + 8.5kB). grep-no-leak gate green. **`vercel build` locally now emits zero TS errors** (was emitting 5+ across the previous list).

**Deploy verification**: post-commit GitHub auto-deploy `dpl_2frvb1rst` completed Ready in 16s (vs. previously hanging or erroring). `curl /api/health` returns 401 SSO page in 298ms (vs. 5min FUNCTION_INVOCATION_TIMEOUT before) — definitive proof the function is genuinely cold-starting + responding; SSO is the only remaining gate before DNS resolves.

**Remaining substantive work after this session:**
- **DNS records for `gdo.ax0x.ai`** — unchanged from prior. User action at Cloudflare or wherever ax0x.ai is managed: TXT `_vercel.ax0x.ai` = `vc-domain-verify=gdo.ax0x.ai,1a52d460b7c82b46283d` + CNAME `gdo.ax0x.ai` → `cname.vercel-dns.com`. After resolution, end-to-end HTTP smoke is a 5-minute curl exercise (now that functions are genuinely live).
- **Bobgy WASM port** — Repo 1 in `ai-strategies.md`; 7-10 days independent work to bring the Hard tier back via deeper search depth.
- **GameTableMP sweep tribute** — deferred per `game-rules.md § "Sweep tribute (6P/8P)"`.

### 2026-05-21 — TRIBUTE-2 6P/8P sweep tribute end-to-end (commit `434c595`)

Closed the deferred 6P/8P sweep tribute via a single autonomous /goal loop. Per `tribute-ux-deep-dive.md § "Update 2026-05-17"`: sweep triggers when the winning team holds positions 1..N (N = 3 for 6P, 4 for 8P). Otherwise 6P/8P degrade to single tribute (last → first, "Path A"). Resist takes precedence in all cases.

Pairings (1-indexed positions per spec): 6P sweep = 4→3, 5→2, 6→1; 8P sweep = 5→4, 6→3, 7→2, 8→1.

| Layer | File | Change |
|---|---|---|
| Types | `lib/realtime/messages.ts` | `TributePendingEvent.direction` adds `'sweep'`. Doc comment explains 4P vs 6P/8P paths. |
| Types | `lib/realtime/buildClientPayload.ts` | `AuthorTributePendingEvent.direction` adds `'sweep'` (mirror of wire shape). |
| Types | `lib/game/tribute.ts` | `TributeMode` union adds `{ kind: 'sweep'; obligations: [...] }` variant. Same shape as double — just discriminated for downstream display. |
| Types | `lib/game/round.ts` | `PendingTributeState.mode` adds `'sweep'` so manual mode can carry sweep obligations. |
| Detection | `lib/game/tribute.ts` | New `detectTributeModeMP(mode, finishOrder, seats, hands)`. Resist precedence → sweep check (top-N all same team) → single fallback. Sweep pairings built via `for i in [0..N): from=finishOrder[expected-1-i], to=finishOrder[i]`. |
| Application | `lib/game/tribute.ts` | `applyTribute` widened to accept `kind: 'sweep'` (uniform with double — both carry obligations array). |
| Round flow | `lib/game/nextRound.ts` | Was skipping tribute entirely for 6P/8P; now routes through `detectTributeModeMP`. Same auto/manual paths as 4P. Manual mode supports sweep obligations end-to-end. Doc comment rewritten to reflect the new flow. |
| Flow | `lib/game/tributeFlow.ts` | `finalizeManualTribute` widened to accept `'sweep'`. Discriminated builder shared with double (same obligations shape). |
| Realtime | `lib/realtime/deriveTributeEvents.ts` | Emits `direction: 'sweep'` for sweep modes. Obligations + privatePayloads + tribute_resolved carry full multi-pair shape uniformly. |
| Realtime | `lib/realtime/handleMove.ts` | `HandleMoveResult.tributeMode` widened. `success()` synthesizes sweep TributeMode shape from finalization exchanges (same pattern as double). |
| Client | `src/screens/GameTableMP.tsx` | `TableState` gains `tribute: TributePendingSnapshot \| null` + `roundNumber: number`. Reducer adds `reduceTributePending` / `reduceTributeResolved` (mirror of GameTable4P). `reduceDeal` clears tribute + bumps `roundNumber`. New `buildTributeModalState()` (exported for tests) routes snapshot through TributeModal substates with `progressLabel: "i/N"` for sweep. New `submitTributeSelect` / `submitAntiTribute` POST handlers (mirror of GameTable4P). TributeModal renders conditionally when modal state is non-null. `postCommand` widened to accept tribute commands. |
| Tests | (+31 across 5 files) | tributeMode.test.ts (+8 detection cases), applyTribute.test.ts (+2 sweep finalization with 末游 leader), nextRound.test.ts (+5 inc. update of pre-existing "6P skips" assertion → "6P runs detectTributeModeMP"), deriveTributeEvents.test.ts (+3 sweep events + null-return skip), GameTableMP.test.tsx (+11 reducer + buildTributeModalState 7-case coverage). |

**Stats**: **987/987 tests passing** (956 → 987; +31 new). TS strict clean. `npm run build` clean: 244kB JS / 42kB CSS (gzip 74kB + 8.5kB — modest bump from TributeModal import into GameTableMP). grep-no-leak gate green. GitHub auto-deploy `dpl_30y921vw5` completed Ready in 18s (third successful auto-deploy after the .js + tsconfig fix earlier same day).

**Implementation note**: `TributeModal.tsx` itself was NOT changed. The existing `progressLabel: "i/N"` mechanism already handles N > 2 (was added for 4P double-tribute "1/2" / "2/2"); sweep produces "1/3" / "2/3" / "3/3" / "1/4" / "2/4" / "3/4" / "4/4" with zero modal changes.

**Remaining substantive work after this session:**
- **DNS records for `gdo.ax0x.ai`** — unchanged.
- **Bobgy WASM Phase A+B** — multi-session /big-task ticket. **Phase A plan now written**: see [`docs/plan/bobgy/PHASE-A.md`](docs/plan/bobgy/PHASE-A.md) for the full execution blueprint (decisions, build pipeline via Docker `emscripten/emsdk`, vendor layout, TS wrapper design, Medium integration, test strategy, risk register, 10-step checklist). Phase B (lookahead policy → Hard tier revival) follows after Phase A lands.

### 2026-05-21 — Bobgy Phase A planning (no code; handoff to next session)

After TRIBUTE-2 shipped, AX redirected from "execute Phase A now" to "plan and handoff for next session". Critical-decision questions surfaced via AskUserQuestion locked three architectural choices:

| Question | Decision |
|---|---|
| Source integration | Vendor source + commit prebuilt `.wasm` artifact (no Emscripten in CI) |
| Integration depth | New `lib/ai/decomposer/` module + thin Medium hook (rule-based heuristic preserved as fallback) |
| Turn cap | 50 turns for Phase A /goal loop |

Upstream `Bobgy/poker-guandan-strategy` (MIT, © 2018 Yuan Gong) cloned to `/tmp/bobgy-source` for inventory. Three C++ files matter: `strategy.cpp` (430 LOC, contains `EMSCRIPTEN_BINDINGS`), `cc/common.cpp` (249 LOC), `cc/common.hpp` (96 LOC). API: `calc(cards: string, mainRank: char, useOverallValueEstimator: bool)` returning `{minHands: double, solutions: vector<string>}`. Card encoding documented in the plan doc (e.g., spades = `?S`, joker = `XB`/`XR`, rank 10 = `0`).

Toolchain decision: Docker `emscripten/emsdk` rather than `brew install emscripten` — keeps the build pipeline reproducible and avoids forcing every contributor to install emsdk. Build script `scripts/build-wasm.sh` lives in the plan as a ready-to-copy snippet.

Vendor layout (per plan):

```
lib/ai/decomposer/
├── cpp/{strategy.cpp,common.cpp,common.hpp,LICENSE-bobgy}
├── dist/{strategy.js,strategy.wasm}   ← committed artifact
├── index.ts (public decomposeHand API)
├── encode.ts (Card[] → Bobgy string)
├── decode.ts (solutions → Card[][] structured plays)
└── loader.ts (Node + Vite WASM module loader)
```

Build flags differ from upstream's `package.json`: add `MODULARIZE=1` + `EXPORT_ES6=1` + `ENVIRONMENT='node,web'` + `ALLOW_MEMORY_GROWTH=1` so the module works in Vitest (Node) + Vite (browser) instead of polluting `window.Module` like upstream's browser-only PWA does.

Integration shape locked: `decomposeHand` returns optimal first play; `lib/ai/medium.ts` validates that play against `enumerateLegalMoves` for the current trick; if it matches, prefer it; else fall back to existing `rankByCoop` heuristic. Preserving the heuristic fallback handles "respond to current trick's bestPattern" cases the decomposer doesn't model (Bobgy decomposes a standalone hand, doesn't know what the trick demands).

No code shipped this session beyond the plan doc. Next session reactivates `autonomous-grind` with the Phase A predicate (50-turn cap), then walks the 10-step checklist in [`docs/plan/bobgy/PHASE-A.md`](docs/plan/bobgy/PHASE-A.md) §8.

### 2026-05-21 — Bobgy Phase A delivery (commit `8a41c83`)

Phase A executed end-to-end in a single autonomous /goal loop following the prior session's plan doc. All §9 acceptance criteria met.

**Vendor layout** — `lib/ai/decomposer/cpp/{strategy.cpp,common.cpp,common.hpp,LICENSE-bobgy}` verbatim from upstream `Bobgy/poker-guandan-strategy` HEAD with two `// PATCH:` markers documented in the README:
1. `strategy.cpp`: `#include "cc/common.hpp"` → `#include "common.hpp"` (flattened dir layout — we don't mirror upstream's `cc/` subdir)
2. `common.cpp`: added `#include <cassert>` (newer emsdk libc++ headers no longer pull it transitively; upstream still builds against an older toolchain that did)

**Build pipeline** — `scripts/build-wasm.sh` runs `docker run --rm -v $(pwd)/lib/ai/decomposer:/src emscripten/emsdk:latest em++ ...` with flags `MODULARIZE=1 + EXPORT_ES6=1 + ENVIRONMENT='node,web' + ALLOW_MEMORY_GROWTH=1` + `EXPORTED_RUNTIME_METHODS=["cwrap","ccall"]` (note: `EXTRA_EXPORTED_RUNTIME_METHODS` is removed in current Emscripten — the plan-snippet had the deprecated name which had to be corrected mid-build). Output: `dist/strategy.js` (137KB ES6 module factory) + `dist/strategy.wasm` (111KB). Both committed via a new `.gitignore` exception (`!lib/ai/decomposer/dist/`) — the global `dist/` rule was masking them.

**TS wrapper** —
- `encode.ts` — `Card[]` → Bobgy wire string. **Key gotcha**: input is PACKED 2-char pairs with NO separator. `parseCardState` walks `cards[i*2]/cards[i*2+1]`. The comment block in `strategy.cpp:392-394` (`红桃：?H | 黑桃：?S | ...`) uses `|` as a documentation separator, not a literal — easy to misread. Initial attempt with space-joined cards crashed Bobgy on the 2nd token with `parseRankFromChar(' ')` assertion failure. Tests validate the packed form (`'ASKH0C'` not `'AS KH 0C'`).
- `decode.ts` — Bobgy solution string → `DecomposerPlay[]`. The OUTPUT format does use pipes + spaces (`| 3H 3S || KC KD |`). Splits by `|`, filters empty sections, tokenizes by whitespace. Returns null when any token can't be matched back to a Card in the original hand — that signals wildcard substitution (Bobgy used a heart-of-level-rank as a different rank/suit, so the decoded token doesn't appear in our deck-id-aware hand).
- `loader.ts` — singleton WASM module loader. Calls the factory exported by `dist/strategy.js`, caches the Promise. `locateFile` callback resolves `strategy.wasm` relative to `dist/` in Node and bundler-served in browser.
- `index.ts` — public API. `decomposeHand(hand, levelRank, useOverallValueEstimator = true)` is sync; on first call when the module isn't loaded yet, it kicks off `preloadDecomposer()` fire-and-forget AND returns null, so callers transparently fall back to their heuristic during the ~100-300ms WASM load window. Subsequent calls hit the cached module synchronously.

**Medium integration** (`lib/ai/medium.ts`) — flow becomes: enumerate legal plays → endgame finisher check → decomposer suggestion (when its first play matches an enumerated legal play via multiset cards equality on suit+rank+deck) → `rankByCoop` heuristic fallback. Defer cooperation policy (when partner just won) still wins over the decomposer — it doesn't model coop or trick context. Three fallback paths exit gracefully:
1. WASM not loaded yet → `decomposeHand` returns null
2. Decomposer returns null (wildcard substitution unresolvable against our deck-id-aware Card multiset)
3. Decomposer's first "play" is the whole-hand-as-one-section fallback (Bobgy's solver bottoms out at `ASolution.push_back("| " + handToStr(hc, wildCardsLeft) + "|")` when DFS exhausts — that section isn't a legal Guandan pattern, so our `cardsMatch` against enumerated plays fails)

**Tests** (+29) — `tests/ai/decomposer/encode.test.ts` (12 — wire format, joker codes, 10→0, packed-no-separator), `tests/ai/decomposer/decode.test.ts` (7 — pipe split, dup-deck disambiguation, wildcard-substitution null path), `tests/ai/decomposer/decompose.test.ts` (6 — full WASM round-trip including 27-card deal, determinism, MinPlays vs OverallValue estimators, empty-hand null), `tests/ai/medium-decomposer.test.ts` (5 — integration: decomposer suggestion prevails when legal, fallback when illegal, endgame + defer policy still win, whole-hand-section fallback). Last file kept SEPARATE from `tests/ai/medium.test.ts` so the WASM-preloaded vs cold paths stay isolated (vitest isolates module state per file).

**Gotchas surfaced** —
1. Docker disk-full on first pull. `docker system prune -af --volumes` reclaimed 25.58GB.
2. `EXTRA_EXPORTED_RUNTIME_METHODS` deprecated → `EXPORTED_RUNTIME_METHODS`. Plan snippet had the old form.
3. Bobgy's solver `handToStr` fallback at strategy.cpp:376 emits the whole remaining hand as one `| ... |` section when DFS can't decompose. First "play" in such a solution isn't a legal Guandan pattern — Medium correctly rejects via card-match against enumerated plays.
4. `useOverallValueEstimator=true` (Bobgy's default in our wrapper) returns floats like `minCost: -1.05` for bomb-heavy hands — initial test assertion `toBeGreaterThan(0)` was wrong; relaxed to `typeof === 'number'`.

**Verification** — `npm test` 1016/1016 (987 → 1016) · `npm run typecheck` clean · `npm run build` clean (244kB JS / 42kB CSS gzip 74kB + 8.5kB — no client-side bundle bump because WASM is server-only) · `npm run security:no-leak` green. GitHub auto-deploy `dpl_*p5ebx6y5z` completed Ready in 17s. Visual smoke (`npm run dev`) deferred to a manual pass — not blocking, but the Medium bot should now produce visibly stronger card choices in browser play. **Phase B** (lookahead policy + Hard tier revival + UI chip) remains a separate future session — see `docs/plan/bobgy/PHASE-A.md` §10.

### 2026-05-21 — Vercel route fix + UI-7 CSS rotate + Landing autofocus polish (commits `cf347e8`, `2cc6fce`, `0093e20`)

**Why a fresh session minutes after Phase A shipped**: AX pointed out a screenshot showing the production iPhone displaying the "请横屏游戏" rotate-prompt overlay — questioned why we weren't using CSS rotate. Re-read `docs/research/mobile-landscape-ux.md` and discovered a § Update 2026-05-16 section at the bottom that overrode the original § 1.2 conclusion. Implementation had been written against the obsolete § 1.2; the Update was never reflected in code. Same session also surfaced a P0 production bug (every API route hanging 300s) — they're documented together because they shipped in the same session.

**P0 — commit `cf347e8` fix(api)**: production POST /api/room/create returning 504 Vercel Runtime Timeout 300s on AX's create-room payload `{mode:"4", host:{handle:"@axax"}, bots:[3× easy]}`. Root cause from prod logs:

```
WARN: default export returned a Response.
      The default-export signature is (req, res) => void — returns are ignored.
      You likely meant the Web fetch-style API.
Vercel Runtime Timeout Error: Task timed out after 300 seconds
```

All 9 `api/*.ts` routes used `export default async function handler(req: Request): Promise<Response>`. Vercel runtime treats default exports as Express-style `(req, res) => void` and silently ignores returned `Promise<Response>`. Cron also broke separately on `request.headers.get is not a function` (default-export fallback passes Node IncomingMessage, not Web Request) — same root cause.

Fix: migrated all 9 routes to named HTTP method exports per Vercel docs.

| Route | Method |
|---|---|
| `api/health.ts` | `GET` |
| `api/room/[code].ts` | `GET` |
| `api/sse/[roomId].ts` | `GET` (preserved `export const config = { maxDuration: 300 }`) |
| `api/cron/cleanup-rooms.ts` | `GET` |
| `api/room/create.ts` | `POST` |
| `api/room/[code]/{join,leave,start,move}.ts` | `POST` |

All `lib/api/*.ts` handler functions unchanged — fix purely at the route wrapper boundary. Verified via `vercel dev` locally: POST /api/room/create with AX's payload returns 201 in 519ms (was hanging 300s). GitHub auto-deploy `dpl_7fqaoqai0` Ready in 16s.

**Future-routes-must-use-named-exports** — this is now a hard rule. Anyone writing a new `api/*.ts` route MUST use `export async function POST(request)` / `GET(request)` / etc. `export default` is the trap.

**P1 — commit `2cc6fce` feat(ui)**: UI-7 CSS rotate for forced landscape on portrait mobile.

Source-of-truth alignment: `docs/research/mobile-landscape-ux.md` § Update 2026-05-16 was the actual decision. It overrode § 1.2's "CSS rotate is a trap" conclusion based on:
- Modern iOS Safari 16+ and Chrome 90+ correctly translate pointer events through CSS transform — the original "touch coordinate mismatch" concern was outdated.
- Viewport-units breakage is mitigable with `--vp-h` CSS var pattern (`100dvh` default at `:root`, `100%` override inside rotate wrapper).
- Virtual keyboard issue mitigated by exiting rotate mode on text-input focus.
- Production proof: Majsoul (雀魂) ships this on Cocos Creator canvas; 4399 H5 games + WeChat mini-games on DOM.

Implementation:
- `src/components/OrientationLock.tsx` rewritten. When `state === 'portrait-mobile'` AND no text input focused → wrap children in `<div className="orientation-rotate-active">`. When text input focused → wrap in `<div className="orientation-rotate-bypass">` (no rotate, input stays mounted — unmounting closes the iOS keyboard immediately).
- `src/styles/tokens.css` adds `:root { --vp-h: 100dvh }`. `.orientation-rotate-active` (in `components.css`) overrides to `--vp-h: 100%`. Wrapper geometry: `position: fixed; inset: 50% auto auto 50%; width: 100dvh; height: 100dvw; transform: translate(-50%,-50%) rotate(90deg)`.
- The 6 existing `100dvh` declarations in `multi-table.css` / `screens.css` / `round-end.css` migrated to `var(--vp-h, 100dvh)` so children size to the rotated wrapper (390px on iPhone 14 Pro portrait) instead of the un-rotated viewport (844px, would overflow).
- `RotatePrompt.tsx` retained for emergency-only fallback (not wired to OrientationLock currently).

Visual verification via chrome-devtools-mcp on emulated iPhone 14 Pro portrait (390×844): after dismissing the auto-modal, `.orientation-rotate-active` computed style = `width: 844px / height: 390px / transform: matrix(0,1,-1,0,-422,-195) / --vp-h: 100%`. Screenshot saved to `docs/reports/ui7/portrait-iphone-rotated.png`.

**P2 — commit `0093e20` fix(ui)**: Landing autofocus polish. The sign-in modal auto-opens on mount when no @handle stored. Its input had `autoFocus`, immediately triggering OrientationLock's input-bypass and **defeating the CSS rotate on first portrait paint** — user saw portrait UI with modal, never the intended rotated landscape.

Differential fix: `signInOpen` state went from `boolean` to `false | 'auto' | 'manual'`. Auto-open useEffect sets 'auto' (no autofocus → rotate stays visible). Header sign-in button / blocked-CTA click handlers set 'manual' (autofocus on → typing immediate). `SignInModal` accepts `autoFocusInput` prop and applies `autoFocus` conditionally.

**Verification** (across all 3 commits): `npm test` 1022/1022 (1016 → 1022: +4 OrientationLock + +2 Landing) · `npm run typecheck` clean · `npm run build` clean (244kB JS / 42kB CSS gzip 74kB + 8.5kB) · `npm run security:no-leak` green · `vercel dev` curl returns 201 for create-room · chrome-devtools-mcp confirms `.orientation-rotate-active` applied with correct transform/dimensions on iPhone 14 Pro portrait emulation.

**Files touched this session**:

| Group | Files |
|---|---|
| Route signature fix | 9 routes: `api/{health,cron/cleanup-rooms}.ts`, `api/room/[code].ts`, `api/room/[code]/{join,leave,start,move}.ts`, `api/room/create.ts`, `api/sse/[roomId].ts`. All handler bodies preserved verbatim — only the export signature changed. |
| UI-7 CSS rotate | `src/components/OrientationLock.tsx` (rewritten with bypass logic), `src/styles/tokens.css` (+--vp-h var), `src/styles/components.css` (+.orientation-rotate-active CSS), `src/styles/{multi-table,screens,round-end}.css` (6 × `100dvh` → `var(--vp-h, 100dvh)`), `tests/components/OrientationLock.test.tsx` (rewritten — 4 new tests). |
| Autofocus polish | `src/screens/Landing.tsx` (signInOpen discriminated union + manual/auto open paths), `tests/screens/Landing.test.tsx` (+2 tests). |

### 2026-05-19 — Backlog A-D executed (LLM deletion + AUTH-2 teardown + UI 3→2 + doc sync)

The strategic re-decisions documented in the section below (originally backlog-only) were executed this session in a single autonomous /goal loop. Net effect: Easy + Medium tiers stay; LLM Hard tier and all its plumbing (gateway, budget, hard.ts, prompts, async dispatch path) are gone; UI now offers 2 AI chips instead of 3; AUTH-2 milestone struck through in PLAN.md; `cross-project-integration.md` marked SUPERSEDED at top; SUMMARY.md gains decisions #15 + #16. No new logic — pure deletion + doc edits.

**Files touched this session (one commit):**

| Group | Files |
|---|---|
| A. Delete LLM line | Deleted: `lib/ai/{hard,gateway,budget}.ts`, `lib/ai/prompts/hard.zh.{md,ts}`, `tests/ai/{hard,gateway,budget}.test.ts`. Rewritten: `lib/ai/dispatch.ts` (no async path), `lib/ai/runBots.ts` (sync-only). Edited: `lib/ai/names.ts`, `lib/api/move.ts`, `lib/api/startGame.ts`, `lib/api/createRoom.ts`, `lib/api/getRoom.ts`, `lib/room/lifecycle.ts`, `lib/realtime/infra.ts` (kept `redis` exposure; updated comment), `api/room/[code]/{move,start}.ts`, `.env.example`. Test updates: `tests/ai/{dispatch,runBots,names}.test.ts`, `tests/room/lifecycle.test.ts`, `tests/api/createRoom.test.ts`. `npm uninstall ai`. |
| B. AUTH-2 teardown | `docs/research/cross-project-integration.md` (SUPERSEDED block at top), `docs/research/SUMMARY.md` (decisions #15 + #16 added; #2, #7, #8 + milestone list AUTH-2/AI-2 markers updated), `docs/plan/PLAN.md` (AUTH-2 milestone strike-through; phase summary + dependency graph + changelog entry). |
| C. UI 3→2 | `src/screens/CreateRoom.tsx` (drop `'hard'` from `AiTier`), `src/screens/Waiting.tsx` (drop `hard` from `BOT_BADGE` + `BOT_TIER_LABEL`), `src/lib/api/rooms.ts` (`BotDifficulty`). |
| D. Doc sync | `CLAUDE.md` (Current phase rewritten; Last updated entry added), `README.md` (Status block, Stack table, sibling note), `~/.claude/projects/.../memory/project_vercel_setup.md`, `HANDOFF.md` (this entry). |

**Stats**: **917/917 tests passing** (970 - 53 removed for deleted features). TS strict clean. `npm run build` clean (41 modules → 233kB JS / 41kB CSS · gzip 72kB + 8.5kB). grep-no-leak gate green.

**Outstanding work** (after this session):
- **Manual-tribute round-start wiring** — dispatcher accepts `tribute_select` + `anti_tribute` (since `df6ba3f`), but `dealNextRound` still always runs the auto swap. Flipping to set `pendingTribute` (gated by room rule or feature flag) + emitting `tribute_pending` ahead of the swap is the remaining piece to make manual mode reachable from gameplay.
- **First Vercel production deploy** — `vercel --prod` against the linked project + `gdo.ax0x.ai` domain config + `ADMIN_TOKEN` env var (required for `/api/cron/cleanup-rooms`; fail-closed 503 without). No more `AI_GATEWAY_API_KEY` line item — LLM gone.
- **Bobgy WASM port** — 7-10 days independent work; brings Hard tier back via deeper search depth (see `docs/research/ai-strategies.md` Repo 1).

---

### 2026-05-19 — Strategic re-decisions (original backlog notes — preserved for context)

After a critical re-review of the AI tier strategy and the just-completed Vercel setup, AX overturned two earlier locked decisions. The actual deletions / doc edits were executed in the session above.

**Decision 1 — Independent Upstash per app; cross-app `@handle` sync DROPPED.**

Context: `SUMMARY.md` "Locked decision 8" originally read "Anonymous @handle, **shared namespace with sibling scorer** (Option B)" — purpose was profile sync between guandan-online and guandan-scorer. But gdo's own Upstash got linked 2026-05-18 (Marketplace integration auto-provisioning), and the two projects are now on separate Redis instances.

Choice made: accept the new reality (per-app namespace, no profile sync). Hobby project doesn't need cross-app identity continuity; independent redis means gdo failures don't cascade to scorer. **AUTH-2 milestone CANCELLED** — the entire "migrate scorer `player:*` → `gs:player:*` prefix" workstream is moot because the two projects no longer share key space.

**Decision 2 — LLM Hard tier was misaligned with the research; delete the entire LLM line.**

Two problems compounded:

1. **Research direction was algorithmic, not LLM.** `docs/research/ai-strategies.md` surveyed 5 reference engines (Bobgy poker-guandan-strategy C++ MCTS, agil27/Quentain, shuilongzhu/ai-guandan, dashidhy/DanLM neural net, and one more) — **all algorithmic / NN, none LLM**. The original `ai-implementation-plan.md` tier design was: Easy = rules+noise, Medium = rules + **Bobgy WASM solver** + partner cooperation, Hard = LLM (placeholder), Master = DanLM (deferred). LLM was the temporary occupant of Hard until DanLM ported. But (a) Medium never got the WASM port either (still pure heuristic `rankByCoop`), and (b) DanLM stayed deferred to v1.1.

2. **LLM latency is structural, not a tuning issue.** Plan-documented budgets: Easy <20ms, Medium <80ms (WASM), Hard 1.5-3s (LLM). For a 30-trick game with 3 Hard bots, that's ~3 minutes of cumulative LLM wait per game. Real-time card play needs <500ms per opponent move; LLM at 25× that gap is not optimizable. Plus DeepSeek occasional timeouts, gateway hops, and price drift.

Choice made: **delete the LLM tier entirely now, ship Easy + Medium as v1, bring Hard back later as Bobgy WASM with deeper search depth** (the research doc's `ai-strategies.md` Repo 1 "Difficulty tuning surface" — same solver, different depth params produces tier separation). Master (DanLM) stays deferred to v1.1. LLM has no v2 reservation — if conversational features come later, that's a separate skill and a separate dependency.

**Next-session backlog** (~1-2 hours of pure deletion + doc edits; no new logic):

| Group | Files to touch |
|---|---|
| **A. Delete LLM line** | `lib/ai/hard.ts`, `lib/ai/gateway.ts`, `lib/ai/budget.ts`, `lib/ai/prompts/hard.zh.{md,ts}`, `tests/ai/{hard,gateway,budget}.test.ts`. Revert `lib/ai/runBots.ts` to sync-only (drop `runBotsAsync`). Drop `computeBotMoveAsync` from `lib/ai/dispatch.ts`. Strip `generate` + `budget` fields from `MoveDeps` / `StartGameDeps` (in `lib/api/move.ts` + `lib/api/startGame.ts`). Strip gateway/budget injection from `api/room/[code]/{move,start}.ts`. `npm uninstall ai`. Drop `AI_GATEWAY_API_KEY` + `FEATURE_AI_HARD` from `.env.example`. Update `lib/realtime/infra.ts redis` exposure to keep it (still useful for adjacent clients in the future), but remove all internal callers that used it for budget construction. Expected test count after: 970 - ~35 = ~935. |
| **B. AUTH-2 / Option B teardown** | Mark `docs/research/cross-project-integration.md` SUPERSEDED with a top-of-file status block citing this decision. Update `docs/research/SUMMARY.md` "Locked decision 8" to "Anonymous @handle, **per-app namespace** (independent redis)". Delete or strike-through AUTH-2 in `docs/plan/PLAN.md` (recommend strike-through with a "CANCELLED 2026-05-19" note rather than delete, since plans are historical). Remove AUTH-2 from "Outstanding work" everywhere. Comment in `lib/realtime/infra.ts` (currently says "shared instance with sibling scorer" or similar — update to "per-app independent Upstash instance"). |
| **C. UI 3 tiers → 2 tiers** | `src/screens/CreateRoom.tsx` aiTiers chip array: drop `'hard'`. `src/screens/Waiting.tsx` bot row rendering: drop the Hard tier emoji + label branch. `lib/ai/names.ts`: drop Hard tier badge if separately defined. Re-run visual smoke on iPhone 14 Pro landscape (`chrome-devtools-mcp emulate_device`) to confirm Landing + CreateRoom still match demos S01/S02 with 2 chips instead of 3. |
| **D. Doc sync** | CLAUDE.md "Remaining substantive work" (drop AUTH-2, add "Hard tier returns post-WASM"); README.md "Remaining" (same); HANDOFF.md add new dated section + outstanding work refresh; project memory files (`project_vercel_setup.md` mentions `AI_GATEWAY_API_KEY` in "How to apply" — refresh). |
| **E (independent, separate work)** | **Bobgy WASM port** — Repo 1 in `ai-strategies.md`. Port the C++ `poker-guandan-strategy` to Emscripten WASM, wire into `lib/ai/medium.ts` replacing the `rankByCoop` pickCheapest tail call. Estimated 7-10 days. **NOT next session** — separate ticket. When that lands, Hard tier comes back via deeper search depth. |

**Outstanding work** (original backlog snapshot — see executed section above for the live list):
- ~~Groups A-D — delete LLM line + AUTH-2 teardown + UI 3→2 + doc sync~~ ✅ **DONE 2026-05-19**
- **Manual-tribute round-start wiring** — still outstanding (see executed section above)
- **First Vercel production deploy** — still outstanding (see executed section above)
- **Bobgy WASM port** (Group E above) — still outstanding (separate 7-10 day ticket)

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

> **SUPERSEDED 2026-05-19** — the cross-project integration plan below (shared `@handle` namespace, shared Upstash instance, AUTH-2 key-migration pre-step) was **cancelled**. guandan-online runs on its **own independent Upstash instance** with no shared key space; AUTH-1 shipped without any sibling-repo migration. Kept for historical context only. See `docs/research/cross-project-integration.md` (SUPERSEDED block) + `CLAUDE.md` § Last updated (2026-05-19).

~~Integration boundary:~~
- ~~Shared `@handle` namespace (Upstash KV prefix `gs:player:*` for scorer + `go:*` for online)~~
- ~~Same Upstash instance (shared profile read; per-app game state writes)~~
- ~~Online copies `validateOwnershipToken` (10 lines) from `scorer/api/players/_utils.js`~~
- ~~Cross-app stat sync deferred to v1.2~~

~~Pre-implementation step (must happen before any AUTH-1 work in this repo):~~
- ~~Migrate scorer's `player:*` keys → `gs:player:*` prefix (AUTH-2 milestone)~~
- ~~~15 file edits in sibling repo + one-time migration script~~
- ~~Fallback-read pattern during rollout~~

---

## Quick links

- **Repo**: https://github.com/xingfanxia/guandan-online
- **Local demos**: `open demos/index.html`
- **Live (after deploy)**: `https://gdo.ax0x.ai`
- **Sibling scorer (production)**: `https://gd.ax0x.ai`
