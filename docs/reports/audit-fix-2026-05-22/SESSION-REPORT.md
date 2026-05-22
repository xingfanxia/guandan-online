# Audit-fix-loop session — 2026-05-22

End-to-end audit (parallel reviewers across 4 layers) + parallel-agent fix pass
+ Playwright e2e infrastructure + Round 2 verify cycle. This was the first
full audit-fix-loop ever run against guandan-online.

## Headline numbers

| Metric | Before | After |
|---|---|---|
| Unit tests | 1022 | 1118 (Round 1) → 1118+ (Round 2 pending) |
| e2e tests | 0 | 47 (chromium + mobile-landscape + mobile-portrait) |
| Tracked source files modified | — | 68 |
| New source files | — | 5 (sharedInfra, vite-api-plugin, e2e helpers, CI workflow, verify-all.sh) |
| New test files | — | 9 (8 e2e specs + 1 sseClient regression unit) |
| Lines added | — | +3,060 |
| Lines removed | — | −283 |
| Critical findings fixed | — | 11 |
| Important findings fixed | — | 19 |
| Minor findings fixed | — | 11+ |

## Findings + fixes

### CRITICAL — discovered via e2e testing

1. **SSE named-event dispatch (silent event drop)** — server emits `event: deal`
   per `lib/realtime/sse.ts formatEvent`; client's `es.onmessage` only fires
   for unnamed events. Every SSE event was being silently dropped — the entire
   game UI would have shown 0 cards in production. Caught the moment the first
   e2e test rendered the table. Fix: register `addEventListener` for each
   discriminator in `SERVER_EVENT_TYPES`. Verified live via chrome-devtools
   (27-card hand renders).
2. **Memory infra isolation in local dev** — each of the 9 Vercel route
   wrappers held its own `createMemoryRoomStore()`, so rooms created in
   `/api/room/create` weren't visible to `/api/room/[code]/start`. Local dev
   + e2e were broken end-to-end. Fix: `lib/realtime/sharedInfra.ts` exposes a
   process-wide singleton; all 9 routes import from it.

### CRITICAL — Game logic

3. **`canBeat` level-rank straight bug** (`lib/game/patterns.ts`) — non-bomb
   sequences (`straight | threePairs | twoTriples`) used `powerRank` for
   comparison, so at level 5 an A-2-3-4-5 (low) wrongly beat 6-7-8-9-10
   (high). New `sequenceRankValue` helper uses natural ordering.
4. **`detectTributeModeMP` 6P/8P fallback** (`lib/game/tribute.ts`) — single
   fallback could route tribute from the winning team's last-finisher to
   themselves. Fix: pick the lowest-positioned LOSER, not just the
   lowest-positioned player.
5. **Decomposer level-10 encoding** (`lib/ai/decomposer/index.ts`) —
   `levelRank.charCodeAt(0)` returned `'1'.charCodeAt(0)` for level '10',
   not `'0'` as the C++ wire format expects. Medium AI silently lost WASM
   assist at level 10. Fix: use `rankToBobgyChar`.
6. **Wildcard enumeration** (`lib/ai/enumerate.ts`) — wildcards isolated in
   their own bucket; bots couldn't play `pair K` using a wildcard, etc. Fix:
   added same-rank wildcard synthesis loop.

### CRITICAL — Realtime / API

7. **SSE Last-Event-ID resume** (`lib/realtime/eventLog.ts`) — the per-room
   INCR seq didn't match `event.version` for any non-first joiner. Reconnect
   missed events permanently. Fix: log id is now `event.version` directly in
   both memory + Upstash impls.
8. **Bot exceptions crash move/start handlers** — `runBots()` threw bricked
   the human's move (idempotency reservation stranded). Fix: try/catch
   around `computeBotMove` in `runBots.ts` + defensive wrappers in
   `move.ts` + `startGame.ts`.
9. **Concurrent start race** — two simultaneous host-token POSTs both
   dealt independent shuffles. Fix: `start-${code}` idempotency reservation.

### CRITICAL — Frontend

10. **App.tsx passed `creds.playerId` as `myHandle`** — `splitSeats` couldn't
    locate the local player, HUD showed `我 · P0`. Fix: store handle alongside
    credentials in `RoomCredentials.handle`; App.tsx prefers `creds.handle ??
    getHandle() ?? ''`.
11. **Card selection desync after own move** — `selected` indices survived
    `move_played`, pointing to wrong cards in the shrunken hand. Fix: clear
    selected on own move_played via `myPlayerIdRef`.

### CRITICAL — Infra

12. **`vercel.json` maxDuration: 300 applied globally** — every endpoint
    inherited the SSE-only 300s ceiling. Cost-of-failure spike. Fix: narrowed
    to SSE=300s / cron=60s / move=30s / default=15s.

### IMPORTANT (19) — abbreviated

- Move handler didn't refresh `lastActiveAt` → cron deleted active games
- In-memory rate limiter useless under Vercel autoscaling → Upstash variant
  via `@upstash/ratelimit`
- SSE log-drain-vs-subscribe race on Upstash → subscribe-first + buffer-and-flush
- `stream_closing` version collided with next real event → omit `id:` line
- POST endpoints (create/join/leave/start) lacked rate-limit + idempotency
- `tsconfig.json` missing `noUnusedLocals`/`Parameters` from app config
- ADMIN_TOKEN blast radius undocumented
- No GitHub Actions CI
- `scripts/build-wasm.sh` used unpinned `emscripten/emsdk:latest`
- ESLint dangling reference / no config
- SSE client lost `lastVersion` on remount; no visibilitychange reconnect
- `localStorage.setItem` unguarded — quota crash; no pruning
- Anti-tribute backdrop click fired for all players (winner click → server
  reject → confused state). Fix: explicit "我们抗贡" button gated by `canDeclare`
- Card/Avatar `role="button"` without keyboard activation (WCAG 2.1.1).
  Fix: render as `<button type="button">`
- Waiting screen hardcoded "宽松 A" regardless of `strictA` rule
- Tribute interpretation (single-tribute / double-tribute pairing)
- Medium tier wasted decomposer call on follower turns
- Dead `if (p.rank === null) return 50_000` branches in easy.ts / coop.ts

### MINOR (11+)

- `.DS_Store` files in repo root + docs/
- `tsconfig.node.json` referenced nonexistent `eslint.config.js`
- `.gitignore` negate-block comment didn't explain order dependency
- JoinModal hardcoded `autoFocus` (brittle pattern)
- `splitSeats` positional-by-team ordering → clock-position
- `pickTributeCard` / double-tribute pairing rule fidelity
- Tribute corner case where winner could "return" the just-tributed card
- `cardsMatch` key format duplicated from `lib/game/cards.ts cardKey`
- Test gap documentation (20+ items added across audit reports)
- README updates for `npm run test:e2e`
- Various dead-code / lint cleanups

### Round 2 audit (focused re-review)

After Round 1 fixes landed and the verify chain went green, a Round 2 audit on
the highest-churn files surfaced:

- **CRITICAL**: Idempotency reservation orphaned on downstream throw (1-hour
  brick on `/start`, 10-min brick on `/move`, 1-hour brick on `/create`).
  Fix: try/catch + commit-error-response on throw.
- **IMPORTANT**: `lastActiveAt` read-modify-write race overwrites concurrent
  `/leave`. Documented as known issue with reproduction test marked
  `.skip()`; architecture fix deferred.
- **IMPORTANT**: `canDeclare` heuristic only enabled the button for the partner
  who happens to hold red jokers — the OTHER losing-team partner saw the
  banner but no CTA. Fix: widen to `myTeam !== winnerTeam`.
- **IMPORTANT**: `createRoom.ts` cached idempotency fallthrough when `details`
  field is absent → duplicate room. Fix: treat as cache corruption.
- **MINOR**: `sseClient.onClose` could fire multiple times; gate via flag.
- **MINOR**: 27 cards as individual tab stops → roving-tabindex pattern.

Round 2 audit explicitly verified clean:
- EventLog id == event.version refactor (no leftover INCR usage)
- Bot try/catch breadth (intentionally wide; documented)
- splitSeats clock-position math
- Concurrent-start idempotency key granularity
- Handle backward-compat fallback (3 states)
- RATE_LIMIT_DEV_MULTIPLIER parsing (NaN / Infinity / 0 rejected)
- Anti-tribute backdrop click removal

## New infrastructure

### e2e harness

`scripts/vite-api-plugin.ts` — Vite middleware plugin that mounts all 9 Vercel
route handlers as Connect middleware on the dev server. `npm run dev` and
Playwright now share a single-origin SPA + API + SSE surface, no separate
`vercel dev` cold-start. The plugin converts Node `IncomingMessage` →
`Request`, calls the handler, streams the `Response.body` back to
`ServerResponse` with abort propagation for SSE cleanup.

`tests/e2e/` — 8 spec files + 2 helpers:

| File | Coverage |
|---|---|
| `health.spec.ts` | `/api/health`, SPA root, SSE 400/401 |
| `landing.spec.ts` | Sign-in modal auto-open / autofocus / persistence / validation, CTA navigation, recent rooms empty state |
| `create-room.spec.ts` | Default rules, strict-A toggle, 4P+3 bots flow, capacity rejection |
| `join-flow.spec.ts` | 2nd-player join, nonexistent code error, short-code rejection |
| `game-flow.spec.ts` | Create → wait → start → deal (4P), card selection enabled on turn, 6P MP table |
| `full-ui-journey.spec.ts` | End-to-end from Landing through deal without API shortcuts |
| `orientation.spec.ts` | Portrait CSS rotate / autofocus bypass / landscape pass-through / desktop bare |
| `error-handling.spec.ts` | MissingCreds screen, room-ended message, API contract responses |

### CI

`.github/workflows/ci.yml` — typecheck + unit + security + (informational
npm audit) and a parallel job for Playwright chromium-desktop with artifact
upload on failure.

### Ops

`scripts/ops/verify-all.sh` — full chain (typecheck → unit → security → build
→ e2e); `--no-e2e` skips Playwright for faster local pass.

## Process notes

- 4 parallel opus fix agents worked simultaneously without file conflicts.
  Each agent owned a distinct layer (game/ai, realtime/api, frontend,
  infra/config) — scoping by directory prevented overlap.
- Two findings (SSE named-event dispatch + memory infra isolation) were
  fixed by the orchestrator directly because they unblocked the e2e
  baseline run — the audit's most valuable result was discovering these
  during the very first attempt to render the table in a browser.
- Tests went from 1022 → 1118 in Round 1 (+96, ~9.4% growth). e2e from
  0 → 47.
- Build artifact unchanged (244kB → 246kB JS, 42kB CSS) — almost all
  added code is either tests or server-side (rate limiter, sharedInfra).
- The rate-limiter wired in R-I5 needed an env-var-gated relaxation for
  e2e tests (memory backend) — production keeps the tight per-route quotas
  by taking the Upstash branch unconditionally.

## Verify chain — final

```
npm run typecheck      ✓ clean
npm test               ✓ 1118 passing
npm run security:no-leak ✓ green
npm run build          ✓ 246kB JS / 42kB CSS (gzip 75kB + 8.8kB)
npm run test:e2e       ✓ 47 passing (chromium-desktop + mobile-portrait + mobile-landscape)
```
