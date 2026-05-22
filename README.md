# Guandan Online (掼蛋联机)

Real online multiplayer **Guandan** (掼蛋) — landscape-first web game for 4 / 6 / 8 players.

## Status

🚧 **Backend + all UI tracks + bot dispatch + Easy/Medium AI tiers + bot-fill + auto/manual tribute + ROOM-2 all 7 rule axes plumbed + production deploy live + GitHub auto-deploy unblocked + TRIBUTE-2 6P/8P sweep tribute end-to-end + Bobgy WASM decomposer Phase A integrated into Medium tier + UI-7 CSS rotate for forced-landscape on portrait mobile + Vercel route signature fix + audit-fix-loop end-to-end (33 + 6 findings fixed, Playwright e2e harness added, CI workflow shipped)** (2026-05-22 audit; see HANDOFF.md). **1138 unit tests + 1 skipped + 47 e2e** (chromium-desktop + mobile-portrait + mobile-landscape; mobile scoped to orientation specs), TS strict clean, `npm run build` clean (~247kB JS / 42kB CSS · gzip 75kB + 8.8kB), grep-no-leak gate green, `vercel build` locally emits zero TS errors. Production aliases (`guandan-online-{henna,panpanmao,xingfanxia-panpanmao}.vercel.app`) live behind team SSO; public access on `gdo.ax0x.ai` pending DNS verification (TXT + CNAME records — see HANDOFF.md). Beyond the P0 logic layer (Guandan rules engine, round/trick/session state machines, tribute, room lifecycle, hidden-state filter), the project ships:

- Live Upstash impls of `IdempotencyCache` / `EventLog` / `EventBus` selected via env-driven `createRealtimeInfra(env)`
- 9 HTTP/SSE routes — create / read / join / leave / start / move / sse / cron-cleanup / health
- Persistence: `roomStore` + `roundStore` + `sessionStore` (Memory + Upstash)
- Move handler emits `move_played` / `move_passed` / `trick_won` / `round_end` / `game_end` / `tribute_pending` / `tribute_resolved` / next-round `deal` via the publish gateway with per-recipient log isolation + a cross-round gameState split (old-round state for events before the next-round deal; new-round state after — closes a leak-detector false-positive on cards the new shuffle redeals). Lifecycle events (`room_joined` / `room_left`) use a shared `RoomState.eventVersion` counter so SSE resume is contiguous across lobby → game. After a human's move, an in-handler bot run-loop (`lib/ai/runBots.ts`) computes + publishes bot turns until landing on a human or round-end.
- End-to-end integration test driving create → join × 3 → start → SSE → play → pass
- **Complete React 19 game surface**: hash router routes through Landing (3 CTAs + recent rooms) → CreateRoom (mode picker + AI tier chips that **persist into RoomState as bot members** + rule toggles) → Waiting (polls room state, renders bot rows with tier-emoji avatars + AI · 入门/进阶 chips, host starts when full) → GameTable4P or shared GameTableMP (6P/8P oval layout). TributeModal covers 4 substates (auto / pending / anti-tribute / return-pending). RoundEnd shows the 13-rung level ladder + result detail; ALevelFinal tints the table warm-red with a strict-mode A-fail counter; Victory celebrates with gold-tinted 胜 + winning roster + MVP.
- **Two AI tiers (v1)** via the synchronous `computeBotMove(ctx)` dispatcher — Easy (rule-based + 30% noise) and Medium (rule-based + partner cooperation: `decidePartnerCoop` returns `defer`/`cover`/`compete`, no random noise, endgame-trumps-deference). The LLM Hard tier was deleted 2026-05-19 (LLM latency 1.5-3s/move is structurally incompatible with real-time card play); Hard returns post-WASM via the Bobgy `poker-guandan-strategy` solver with deeper search depth (Phase B — see below).
- **Bobgy WASM decomposer (Phase A — shipped 2026-05-21)**: `lib/ai/decomposer/` vendors upstream `Bobgy/poker-guandan-strategy` (MIT © 2018 Yuan Gong) with a prebuilt WASM artifact (~248KB) committed at `lib/ai/decomposer/dist/strategy.{js,wasm}`. Built via `scripts/build-wasm.sh` (Docker `emscripten/emsdk`, re-run only when `lib/ai/decomposer/cpp/` changes). TS wrapper exposes `decomposeHand(hand, levelRank)` (sync; auto-loads on first call) + `preloadDecomposer()` (optional). `lib/ai/medium.ts` plays the decomposer's first suggested play when it matches an enumerated legal response; falls back to existing heuristic in three cases (WASM not loaded yet, wildcard substitution unresolvable against deck-id-aware Card matching, or decomposer's whole-hand-as-one-section solver fallback). Endgame finisher + defer cooperation policy still take priority over the decomposer.
- **UI-7 CSS rotate for forced landscape (shipped 2026-05-21)**: `src/components/OrientationLock.tsx` wraps children in a `.orientation-rotate-active` div that's rotated 90° via CSS when the device is portrait-mobile, sized to swapped viewport dimensions (`width: 100dvh`, `height: 100dvw`). When a text input takes focus, swaps to `.orientation-rotate-bypass` (no rotate, input stays mounted so the iOS keyboard doesn't close). Children that need viewport-sized heights use `var(--vp-h, 100dvh)` — `--vp-h` is `100dvh` by default but overridden to `100%` inside the rotate wrapper. Replaces the prior "请横屏游戏" rotate-prompt as primary UX (per `docs/research/mobile-landscape-ux.md` § Update 2026-05-16 — Majsoul / 4399 ship this pattern in production; modern iOS Safari 16+ and Chrome 90+ correctly translate pointer events through the transform). `RotatePrompt` retained for emergency-only fallback.
- **Vercel route signature fix (shipped 2026-05-21)**: all 9 `api/*.ts` routes migrated from `export default async function handler(req: Request): Promise<Response>` to named HTTP method exports (`export async function POST(request)` / `GET(request)`). Default-export-of-Promise-Response was being silently ignored by Vercel's runtime (treated as Express `(req, res) => void` signature) — every POST/GET hung until 300s timeout. Cron also broke because the silent fallback passed a Node IncomingMessage where Web Request was expected (`request.headers.get is not a function`). Same root cause; same fix.
- **Auto-tribute multi-round flow**: after round_end (4P), `dealNextRound` orchestrator runs shuffle → deal → `detectTributeMode4P` → `applyTribute` → `startTrick` in one step. `deriveTributeEvents` builds `tribute_pending` (with per-recipient `owedCard` via privatePayloads) + `tribute_resolved` (single/double exchanges) or just `tribute_pending(direction='anti_tribute')` for resist.
- **Manual tribute commands**: `handleMoveCommand` dispatches `tribute_select` / `anti_tribute` through pure transitions in `lib/game/tributeFlow.ts` (`selectTributeCard` validates ownership + card-in-hand + wildcard exemption + no-double-select; `declareAntiTribute` requires resist mode + losing-team player; finalization runs `applyTribute` + `startTrick` and clears `pendingTribute`). Auto-mode at round-start is unchanged — wiring `dealNextRound` to set `pendingTribute` instead of running the auto swap is a future phase.
- **Vercel project linked**: `panpanmao/guandan-online` (separate from sibling scorer `guandan-calc`), Upstash Redis provisioned via Marketplace **as an independent instance**. Env vars read either `UPSTASH_REDIS_REST_*` or `KV_REST_API_*` (UPSTASH-prefixed wins). No shared key space with sibling scorer.
- **Audit-fix-loop output (2026-05-22)**: 33 findings fixed in Round 1 (4 parallel opus agents per layer) + 6 more in Round 2; Round 3 converged clean. Critical discoveries surfaced via the first e2e attempts: (a) **SSE named-event dispatch was silently dropping every event** in production (server emitted `event: deal` per spec but client only listened on `es.onmessage`) — fixed by registering `addEventListener` per `ServerEvent` type; (b) **memory infra was per-route in local dev** — each route had its own `createMemoryRoomStore()` so rooms didn't propagate between `/api/room/create` and `/api/room/[code]/start`; fixed via `lib/realtime/sharedInfra.ts` process singleton. New infrastructure: `scripts/vite-api-plugin.ts` mounts all 9 Vercel routes as Connect middleware on the Vite dev server (no `vercel dev` needed); `tests/e2e/` Playwright suite; `.github/workflows/ci.yml` runs typecheck/unit/security/e2e on PR + push; `scripts/ops/verify-all.sh` for the full local chain.

Remaining: **DNS records for `gdo.ax0x.ai`** at the user's DNS provider (one TXT for verification + one CNAME for traffic) + end-to-end HTTP smoke (gated by DNS) + **Bobgy WASM Phase B** to bring Hard tier back (lookahead policy on top of the Phase A decomposer + Hard tier revival + UI chip; materially harder than Phase A — see `docs/plan/bobgy/PHASE-A.md` §10). GitHub auto-deploy path was unblocked 2026-05-21 (commit `edeb6c7` migrated 275 relative TS imports to `.js` suffixes + added root `compilerOptions` so Vercel's per-function tsc check sees `strict: true` + node types). TRIBUTE-2 6P/8P sweep shipped 2026-05-21 (commit `434c595` extended the existing TributeMode/applyTribute/dealNextRound stack to handle multi-pair sweep, wired GameTableMP reducer + TributeModal). AUTH-2 sibling KV migration is **cancelled** 2026-05-19 — per-app independent Upstash means there's no shared key space. See [`HANDOFF.md`](HANDOFF.md) for the commit-by-commit map and [`docs/plan/PLAN.md`](docs/plan/PLAN.md) for the full 31-milestone roadmap.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite 8 + React 19 + TypeScript 6 (strict mode, `noUncheckedIndexedAccess`) |
| Backend | Vercel `/api/*.ts` serverless functions on Fluid Compute (Node 24.x via project Node Version setting, 300s default timeout; explicit `maxDuration: 300` retained on SSE route for clarity) |
| Transport | SSE + POST + Upstash Redis pub/sub (NOT Colyseus / PartyKit) — locked per `docs/research/realtime-sync-deep-dive.md` |
| Persistence | Upstash Redis (per-app independent instance; sibling scorer runs on its own) |
| Tests | Vitest 4 + V8 coverage (95%+ target on `lib/game/*`) |
| AI | 2 tiers (v1): Easy (rule-based + 30% noise), Medium (rule + partner cooperation + Bobgy WASM decomposer Phase A). Hard tier returns in Phase B via lookahead on top of the same decomposer. |
| Domain | `gdo.ax0x.ai` (sibling subdomain to scorer at `gd.ax0x.ai`) |

## Local development

```bash
npm install              # ~150 packages (adds jsdom + @testing-library/react + @playwright/test)
npm run dev              # Vite dev server on :5174 — includes the API middleware
                         # plugin so /api/* routes resolve in-process against the
                         # memory backend (scripts/vite-api-plugin.ts mounts all
                         # 9 handlers as Connect middleware). No `vercel dev`
                         # needed for local development.
npm test                 # vitest run (1118 tests as of 2026-05-21 post-audit-fix)
npm run typecheck        # tsc -b
npm run test:coverage    # V8 coverage; outputs to coverage/
npm run test:e2e         # Playwright (chromium-desktop + mobile-portrait +
                         # mobile-landscape projects). Uses the same Vite api
                         # middleware as `npm run dev`. Mobile projects only
                         # run orientation specs; full flows run on chromium.
npm run test:e2e:ui      # Playwright UI mode for interactive debugging
npm run test:e2e:report  # open the latest HTML report
npm run security:no-leak # grep-no-leak CI gate (enforces single publish site)
./scripts/build-wasm.sh  # rebuild Bobgy decomposer WASM (Docker required; only re-run when lib/ai/decomposer/cpp/ changes)
./scripts/ops/verify-all.sh         # full verify chain (typecheck → unit → security → build → e2e)
./scripts/ops/verify-all.sh --no-e2e  # same without Playwright (faster local pass)
```

Copy `.env.example` → `.env.local` and fill in Upstash + admin token values for any code path that hits KV. The dev server falls back to an in-memory backend when Upstash env vars are absent; e2e tests run against this in-memory backend.

**Dev rate-limit relaxation**: in dev / e2e mode (memory backend), rate-limit caps are multiplied by `RATE_LIMIT_DEV_MULTIPLIER` (default 50) so e2e tests don't trip the production-tight quotas (`5 creates/min`, etc.). Production with Upstash takes the unmultiplied path.

## Sibling project

The companion scoring app lives at [`../guandan-scorer`](../guandan-scorer) — it tracks team progression, honors, rooms, and player profiles for in-person play. This repo is the actual playable game. The two projects run on **independent Upstash instances** (per-app namespace) as of 2026-05-19; no profile sync across apps. Online still copies sibling's 10-line `validateOwnershipToken` for handle ownership semantics (pure function — no cross-app reads).

## License

TBD — to be decided before public launch.
