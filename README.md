# Guandan Online (掼蛋联机)

Real online multiplayer **Guandan** (掼蛋) — landscape-first web game for 4 / 6 / 8 players.

## Status

🚧 **Backend wire-complete end-to-end** (2026-05-18). **629/629 tests**, TS strict clean, grep-no-leak gate green. Beyond the P0 logic layer (Guandan rules engine, round/trick/session state machines, tribute, room lifecycle, Easy AI bot, hidden-state filter), the project now ships:

- Live Upstash impls of `IdempotencyCache` / `EventLog` / `EventBus` selected via env-driven `createRealtimeInfra(env)`
- 8 HTTP/SSE routes — create / read / join / leave / start / move / sse / health
- Persistence: `roomStore` + `roundStore` (Memory + Upstash)
- Move handler emits `move_played` / `move_passed` / `trick_won` via the publish gateway with per-recipient log isolation (no SSE backlog leaks)
- End-to-end integration test driving create → join × 3 → start → SSE → play → pass

Remaining: `GameSession` persistence for `round_end` / `game_end` events, lifecycle event fanout, UI-1 / UI-2 landscape gameplay, AUTH-2 sibling KV migration (Critical Decision), AI-2 Medium WASM solver. See [`HANDOFF.md`](HANDOFF.md) for the commit-by-commit map and [`docs/plan/PLAN.md`](docs/plan/PLAN.md) for the full 31-milestone roadmap.

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
npm install              # ~80 packages
npm run dev              # Vite dev server on :5174
npm test                 # vitest run (629 tests as of 2026-05-18)
npm run typecheck        # tsc -b
npm run test:coverage    # V8 coverage; outputs to coverage/
npm run security:no-leak # grep-no-leak CI gate (enforces single publish site)
```

Copy `.env.example` → `.env.local` and fill in Upstash + admin token values for any code path that hits KV.

## Sibling project

The companion scoring app lives at [`../guandan-scorer`](../guandan-scorer) — it tracks team progression, honors, rooms, and player profiles for in-person play. This repo is the actual playable game. Shared `@handle` namespace (Option B) means a user's profile follows them across both apps.

## License

TBD — to be decided before public launch.
