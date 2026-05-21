# Guandan Online (掼蛋联机)

Real online multiplayer **Guandan** (掼蛋) — landscape-first web game for 4 / 6 / 8 players.

## Status

🚧 **Backend + all UI tracks + bot dispatch + Easy/Medium AI tiers + bot-fill + auto/manual tribute + ROOM-2 all 7 rule axes plumbed + production deploy live + GitHub auto-deploy unblocked + TRIBUTE-2 6P/8P sweep tribute end-to-end + Bobgy WASM decomposer Phase A integrated into Medium tier** (2026-05-21; see HANDOFF.md). **1016/1016 tests**, TS strict clean, `npm run build` clean (244kB JS / 42kB CSS · gzip 74kB + 8.5kB — no client-side bundle bump from Phase A; WASM is server-only), grep-no-leak gate green, `vercel build` locally emits zero TS errors. Production aliases (`guandan-online-{henna,panpanmao,xingfanxia-panpanmao}.vercel.app`) live behind team SSO; public access on `gdo.ax0x.ai` pending DNS verification (TXT + CNAME records — see HANDOFF.md). Beyond the P0 logic layer (Guandan rules engine, round/trick/session state machines, tribute, room lifecycle, hidden-state filter), the project ships:

- Live Upstash impls of `IdempotencyCache` / `EventLog` / `EventBus` selected via env-driven `createRealtimeInfra(env)`
- 9 HTTP/SSE routes — create / read / join / leave / start / move / sse / cron-cleanup / health
- Persistence: `roomStore` + `roundStore` + `sessionStore` (Memory + Upstash)
- Move handler emits `move_played` / `move_passed` / `trick_won` / `round_end` / `game_end` / `tribute_pending` / `tribute_resolved` / next-round `deal` via the publish gateway with per-recipient log isolation + a cross-round gameState split (old-round state for events before the next-round deal; new-round state after — closes a leak-detector false-positive on cards the new shuffle redeals). Lifecycle events (`room_joined` / `room_left`) use a shared `RoomState.eventVersion` counter so SSE resume is contiguous across lobby → game. After a human's move, an in-handler bot run-loop (`lib/ai/runBots.ts`) computes + publishes bot turns until landing on a human or round-end.
- End-to-end integration test driving create → join × 3 → start → SSE → play → pass
- **Complete React 19 game surface**: hash router routes through Landing (3 CTAs + recent rooms) → CreateRoom (mode picker + AI tier chips that **persist into RoomState as bot members** + rule toggles) → Waiting (polls room state, renders bot rows with tier-emoji avatars + AI · 入门/进阶 chips, host starts when full) → GameTable4P or shared GameTableMP (6P/8P oval layout). TributeModal covers 4 substates (auto / pending / anti-tribute / return-pending). RoundEnd shows the 13-rung level ladder + result detail; ALevelFinal tints the table warm-red with a strict-mode A-fail counter; Victory celebrates with gold-tinted 胜 + winning roster + MVP.
- **Two AI tiers (v1)** via the synchronous `computeBotMove(ctx)` dispatcher — Easy (rule-based + 30% noise) and Medium (rule-based + partner cooperation: `decidePartnerCoop` returns `defer`/`cover`/`compete`, no random noise, endgame-trumps-deference). The LLM Hard tier was deleted 2026-05-19 (LLM latency 1.5-3s/move is structurally incompatible with real-time card play); Hard returns post-WASM via the Bobgy `poker-guandan-strategy` solver with deeper search depth (Phase B — see below).
- **Bobgy WASM decomposer (Phase A — shipped 2026-05-21)**: `lib/ai/decomposer/` vendors upstream `Bobgy/poker-guandan-strategy` (MIT © 2018 Yuan Gong) with a prebuilt WASM artifact (~248KB) committed at `lib/ai/decomposer/dist/strategy.{js,wasm}`. Built via `scripts/build-wasm.sh` (Docker `emscripten/emsdk`, re-run only when `lib/ai/decomposer/cpp/` changes). TS wrapper exposes `decomposeHand(hand, levelRank)` (sync; auto-loads on first call) + `preloadDecomposer()` (optional). `lib/ai/medium.ts` plays the decomposer's first suggested play when it matches an enumerated legal response; falls back to existing heuristic in three cases (WASM not loaded yet, wildcard substitution unresolvable against deck-id-aware Card matching, or decomposer's whole-hand-as-one-section solver fallback). Endgame finisher + defer cooperation policy still take priority over the decomposer.
- **Auto-tribute multi-round flow**: after round_end (4P), `dealNextRound` orchestrator runs shuffle → deal → `detectTributeMode4P` → `applyTribute` → `startTrick` in one step. `deriveTributeEvents` builds `tribute_pending` (with per-recipient `owedCard` via privatePayloads) + `tribute_resolved` (single/double exchanges) or just `tribute_pending(direction='anti_tribute')` for resist.
- **Manual tribute commands**: `handleMoveCommand` dispatches `tribute_select` / `anti_tribute` through pure transitions in `lib/game/tributeFlow.ts` (`selectTributeCard` validates ownership + card-in-hand + wildcard exemption + no-double-select; `declareAntiTribute` requires resist mode + losing-team player; finalization runs `applyTribute` + `startTrick` and clears `pendingTribute`). Auto-mode at round-start is unchanged — wiring `dealNextRound` to set `pendingTribute` instead of running the auto swap is a future phase.
- **Vercel project linked**: `panpanmao/guandan-online` (separate from sibling scorer `guandan-calc`), Upstash Redis provisioned via Marketplace **as an independent instance**. Env vars read either `UPSTASH_REDIS_REST_*` or `KV_REST_API_*` (UPSTASH-prefixed wins). No shared key space with sibling scorer.

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
npm install              # ~150 packages (adds jsdom + @testing-library/react)
npm run dev              # Vite dev server on :5174
npm test                 # vitest run (1016 tests as of 2026-05-21)
npm run typecheck        # tsc -b
npm run test:coverage    # V8 coverage; outputs to coverage/
npm run security:no-leak # grep-no-leak CI gate (enforces single publish site)
./scripts/build-wasm.sh  # rebuild Bobgy decomposer WASM (Docker required; only re-run when lib/ai/decomposer/cpp/ changes)
```

Copy `.env.example` → `.env.local` and fill in Upstash + admin token values for any code path that hits KV.

## Sibling project

The companion scoring app lives at [`../guandan-scorer`](../guandan-scorer) — it tracks team progression, honors, rooms, and player profiles for in-person play. This repo is the actual playable game. The two projects run on **independent Upstash instances** (per-app namespace) as of 2026-05-19; no profile sync across apps. Online still copies sibling's 10-line `validateOwnershipToken` for handle ownership semantics (pure function — no cross-app reads).

## License

TBD — to be decided before public launch.
