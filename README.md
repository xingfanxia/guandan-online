# Guandan Online (掼蛋联机)

Real online multiplayer **Guandan** (掼蛋) — landscape-first web game for 4 / 6 / 8 players.

## Status

🚧 **Backend + all UI tracks + bot dispatch + full AI tier ladder + bot-fill + auto-tribute realtime + Hard async shipped** (2026-05-18). **922/922 tests**, TS strict clean, `pnpm build` clean (233kB JS / 41kB CSS · gzip 72kB + 8.5kB), grep-no-leak gate green. Beyond the P0 logic layer (Guandan rules engine, round/trick/session state machines, tribute, room lifecycle, hidden-state filter), the project ships:

- Live Upstash impls of `IdempotencyCache` / `EventLog` / `EventBus` selected via env-driven `createRealtimeInfra(env)`
- 9 HTTP/SSE routes — create / read / join / leave / start / move / sse / cron-cleanup / health
- Persistence: `roomStore` + `roundStore` + `sessionStore` (Memory + Upstash)
- Move handler emits `move_played` / `move_passed` / `trick_won` / `round_end` / `game_end` / `tribute_pending` / `tribute_resolved` / next-round `deal` via the publish gateway with per-recipient log isolation + a cross-round gameState split (old-round state for events before the next-round deal; new-round state after — closes a leak-detector false-positive on cards the new shuffle redeals). Lifecycle events (`room_joined` / `room_left`) use a shared `RoomState.eventVersion` counter so SSE resume is contiguous across lobby → game. After a human's move, an in-handler **async** bot run-loop (`lib/ai/runBots.ts` → `runBotsAsync`) computes + publishes bot turns until landing on a human or round-end.
- End-to-end integration test driving create → join × 3 → start → SSE → play → pass
- **Complete React 19 game surface**: hash router routes through Landing (3 CTAs + recent rooms) → CreateRoom (mode picker + AI tier chips that **persist into RoomState as bot members** + rule toggles) → Waiting (polls room state, renders bot rows with tier-emoji avatars + AI · 入门/进阶/高手 chips, host starts when full) → GameTable4P or shared GameTableMP (6P/8P oval layout). TributeModal covers 4 substates (auto / pending / anti-tribute / return-pending). RoundEnd shows the 13-rung level ladder + result detail; ALevelFinal tints the table warm-red with a strict-mode A-fail counter; Victory celebrates with gold-tinted 胜 + winning roster + MVP.
- Three AI tiers via dual dispatchers — sync `computeBotMove(ctx)` for Easy + Medium, async `computeBotMoveAsync(ctx)` for Hard (awaits Vercel AI Gateway via injected `generate` fn). Hard has 5 silent-fallback triggers (feature flag off, budget exhausted, throws, unparseable, index OOB) + monthly budget guardrail; degrades to Medium when `generate` fn isn't wired.
- **Auto-tribute multi-round flow**: after round_end (4P), `dealNextRound` orchestrator runs shuffle → deal → `detectTributeMode4P` → `applyTribute` → `startTrick` in one step. `deriveTributeEvents` builds `tribute_pending` (with per-recipient `owedCard` via privatePayloads) + `tribute_resolved` (single/double exchanges) or just `tribute_pending(direction='anti_tribute')` for resist. Manual `tribute_select` / `anti_tribute` commands still deferred (TRIBUTE-1 part E).

Remaining: AUTH-2 sibling KV migration (Critical Decision), TRIBUTE-1 part E manual `tribute_select` command dispatch (UI substates S11/S12/S13 ready; server returns invalid_move), production Vercel AI Gateway client wiring (`MoveDeps.generate` accepts the client — needs route wrappers to inject the real LLM), `createUpstashBudget()` for production budget persistence. See [`HANDOFF.md`](HANDOFF.md) for the commit-by-commit map and [`docs/plan/PLAN.md`](docs/plan/PLAN.md) for the full 31-milestone roadmap.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite 8 + React 19 + TypeScript 6 (strict mode, `noUncheckedIndexedAccess`) |
| Backend | Vercel `/api/*.ts` serverless functions on Fluid Compute (`nodejs22.x`, 300s timeout) |
| Transport | SSE + POST + Upstash Redis pub/sub (NOT Colyseus / PartyKit) — locked per `docs/research/realtime-sync-deep-dive.md` |
| Persistence | Upstash Redis (shared instance with sibling scorer; namespaced keys) |
| Tests | Vitest 4 + V8 coverage (95%+ target on `lib/game/*`) |
| AI | 3 tiers: Easy (rule-based + noise), Medium (rule + WASM solver), Hard (DeepSeek LLM via Vercel AI Gateway) |
| Domain | `gdo.ax0x.ai` (sibling subdomain to scorer at `gd.ax0x.ai`) |

## Local development

```bash
npm install              # ~150 packages (adds jsdom + @testing-library/react)
npm run dev              # Vite dev server on :5174
npm test                 # vitest run (922 tests as of 2026-05-18)
npm run typecheck        # tsc -b
npm run test:coverage    # V8 coverage; outputs to coverage/
npm run security:no-leak # grep-no-leak CI gate (enforces single publish site)
```

Copy `.env.example` → `.env.local` and fill in Upstash + admin token values for any code path that hits KV.

## Sibling project

The companion scoring app lives at [`../guandan-scorer`](../guandan-scorer) — it tracks team progression, honors, rooms, and player profiles for in-person play. This repo is the actual playable game. Shared `@handle` namespace (Option B) means a user's profile follows them across both apps.

## License

TBD — to be decided before public launch.
