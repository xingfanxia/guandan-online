# Guandan Online (掼蛋联机)

Real online multiplayer **Guandan** (掼蛋) — landscape-first web game for 4 / 6 / 8 players.

## Status

🚧 **Backend + UI-1/UI-2 + full AI tier ladder shipped** (2026-05-18). **768/768 tests**, TS strict clean, grep-no-leak gate green. Beyond the P0 logic layer (Guandan rules engine, round/trick/session state machines, tribute, room lifecycle, hidden-state filter), the project now ships:

- Live Upstash impls of `IdempotencyCache` / `EventLog` / `EventBus` selected via env-driven `createRealtimeInfra(env)`
- 9 HTTP/SSE routes — create / read / join / leave / start / move / sse / cron-cleanup / health
- Persistence: `roomStore` + `roundStore` + `sessionStore` (Memory + Upstash)
- Move handler emits `move_played` / `move_passed` / `trick_won` / `round_end` / `game_end` via the publish gateway with per-recipient log isolation (no SSE backlog leaks). Lifecycle events (`room_joined` / `room_left`) use a shared `RoomState.eventVersion` counter so SSE resume is contiguous across lobby → game.
- End-to-end integration test driving create → join × 3 → start → SSE → play → pass
- React 19 game surface: Card / Hand / Trick / Avatar primitives + OrientationLock + GameTable4P that reduces live SSE events through a pure reducer (`#table=<roomId>&token=<t>&me=@handle` in the URL opens a playable table today)
- Three AI tiers via single `computeBotMove(ctx)` dispatcher: Easy (rule-based + 30% noise), Medium (no noise + partner cooperation — defer/cover/compete), Hard (LLM via Vercel AI Gateway with 5 silent-fallback triggers + monthly budget guardrail)

Remaining: UI-3 / UI-4 / UI-5 / UI-6 (landing / tribute / round-end / 6P-8P), AUTH-2 sibling KV migration (Critical Decision), bot wire-up in `api/room/[code]/move`, `createUpstashBudget()` for production budget persistence. See [`HANDOFF.md`](HANDOFF.md) for the commit-by-commit map and [`docs/plan/PLAN.md`](docs/plan/PLAN.md) for the full 31-milestone roadmap.

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
npm test                 # vitest run (768 tests as of 2026-05-18)
npm run typecheck        # tsc -b
npm run test:coverage    # V8 coverage; outputs to coverage/
npm run security:no-leak # grep-no-leak CI gate (enforces single publish site)
```

Copy `.env.example` → `.env.local` and fill in Upstash + admin token values for any code path that hits KV.

## Sibling project

The companion scoring app lives at [`../guandan-scorer`](../guandan-scorer) — it tracks team progression, honors, rooms, and player profiles for in-person play. This repo is the actual playable game. Shared `@handle` namespace (Option B) means a user's profile follows them across both apps.

## License

TBD — to be decided before public launch.
