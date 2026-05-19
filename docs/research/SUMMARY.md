# Research Synthesis — Guandan Online

**Status**: Research phase complete (2026-05-16). 13 investigation streams ran across two phases; this document is the cross-cutting synthesis. Read this first; per-stream files are the deep references.

## TL;DR (7 headlines)

1. **Realtime stack: Vercel-native SSE+POST + Upstash Redis pub/sub** — locked. No Fly.io / Colyseus / extra dependency. ~200 lines of glue (hidden-state filtering + reconnect) replaces the framework convenience. Latency budget 50-165ms end-to-end, within Guandan's 200ms target. Lichess's `lila-ws` is the closest production analog.

2. **AI is v1-shippable in 2 tiers** — Easy (rule-based + 30% noise) and Medium (rule-based + partner awareness; WASM solver port pending). The LLM Hard tier was deleted 2026-05-19 (see decision #15) and returns post-WASM via deeper Bobgy search depth. Master tier (DanLM neural net) deferred to v1.1.

3. **Mobile landscape via CSS rotate** (Majsoul-style) — iOS Safari does not implement `screen.orientation.lock()`; the production fix is CSS `transform: rotate(90deg)` on root + JS-set logical viewport CSS vars. Native lock on Android. Rotate-prompt overlay is emergency fallback only.

4. **Cards: zero external assets needed for v1** — Unicode suits (♥♦♣♠) + Geist 700 with `tabular-nums` + `letter-spacing: -0.03em` on `.card__rank` beats every external SVG deck on weight, license cleanliness, and aesthetic fit for our 28px landscape layout. Card backs are `repeating-linear-gradient` CSS, 0 KB. Heart-suit wildcard (红心级牌) treatment: gold edge + ★ corner badge (Option A confirmed).

5. **PRC delivery is viable but requires care** — `*.vercel.app` is DNS-poisoned in mainland China; **custom domain required day 1**. Realistic Vercel POP latency from Tier-1 PRC cities is 80-180ms p50, 300-500ms p95 under GFW throttle. Turn-based gameplay tolerates this. Ship Vercel-only with client-side latency beacons; deploy Tencent Cloud Shenzhen mirror only if p95 > 350ms observed.

6. **Tribute mechanic fully specified** — Cross-referenced 4 Chinese tournament PDFs (NUIST / SEU / CUP / 中国掼蛋研究院). All prior open questions resolved: 双下 both 3rd+4th tribute; 抗贡 needs 2 大王 (not mixed jokers); tribute card auto-pick in tournament, player-pick in casual; 还贡 always winner's choice with ≤10 cap fallback; "贡左还右" canonical. 6/8 modes get a 3-mode room selector.

7. **Cross-project integration**: ~~Option B (shared namespace)~~ — SUPERSEDED 2026-05-19. Accepted reality: independent Upstash per app (Marketplace integration auto-provisioned a separate instance for guandan-online). No cross-app stats sync, no shared key space. Online still copies sibling's 10-line `validateOwnershipToken` for handle ownership semantics (pure function — no cross-app reads needed). AUTH-2 milestone cancelled. See decision #16.

## Recommended stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend framework | **Vite + TypeScript + React** | Vite for fast HMR + ESM-native. SSR not needed for a game. |
| State on client | Zustand + `EventSource` SDK | Reactive store + native browser SSE. |
| Rendering | **CSS `transform` / `opacity`** | < 100 nodes, easy theming, accessible. Reject Pixi/Phaser. |
| Card assets | **Unicode + Geist 700 + tabular-nums** | Zero external dependencies. Bundle delta = 0 KB. |
| Orientation lock | **CSS rotate (iOS) + native lock (Android)** | Majsoul pattern. Rotate-prompt fallback. |
| Realtime transport | **Vercel SSE+POST + Upstash Redis** | Platform unity. ~200 lines glue. ~$0 marginal. |
| Backup if SSE hits a wall | Colyseus on Fly.io | Not in v1 plan. Documented escape. |
| Persistence | Upstash Redis (Vercel Marketplace) | Same as sibling scorer. Per-room key + event log stream. |
| Frontend host | Vercel with **custom domain day 1** | `*.vercel.app` DNS-poisoned in PRC. |
| PRC mirror (deferred) | Tencent Cloud Run Shenzhen | Only if observed p95 > 350ms. Geo-route via Vercel Edge Middleware. |
| Auth | Anonymous @handle (shared with sibling) | Option B from `cross-project-integration.md`. Copy `validateOwnershipToken`. |
| Rules engine | Port `hash-panda/guandan-guide` (TS) | Most rigorous open-source trick engine. License: check before adopt. |
| AI Easy / Medium | TS + WASM (zdhgg + Bobgy) | Server-side, inline in POST handler. |
| AI Hard | DeepSeek LLM with candidate pre-filter | Feature-flagged. ~$0.01-0.05 per game. Vercel AI Gateway. |
| AI Master (v1.1) | DanLM neural net (deferred) | macOS .so only; open issue with author. |
| Anti-cheat v1 | Rate-limit + IP throttle + report + Vercel BotID | ~340 LOC, 5-6 days. |

## Locked decisions (2026-05-16)

1. **Realtime**: Vercel SSE+POST + Upstash Redis pub/sub (NOT Colyseus / NOT PartyKit for v1)
2. **Mobile orientation**: CSS rotate (Majsoul-style) on iOS, native lock on Android, rotate-prompt as emergency fallback
3. **Rendering**: CSS DOM + transform/opacity (NOT WebGL / PixiJS / Phaser / Canvas)
4. **Card visual**: Unicode suits + Geist 700 + tabular-nums (NO external SVG decks for v1)
5. **Card back**: CSS `repeating-linear-gradient` using existing tokens (NO PNG / SVG asset)
6. **Wildcard treatment**: Gold edge stroke + ★ corner badge (Option A)
7. **AI tier strategy**: Different engines per tier (NOT same engine + search depth)
8. **Auth**: Anonymous @handle, **per-app namespace, independent Upstash instance** (SUPERSEDES Option B from `cross-project-integration.md` — see decisions #15 + #16 below)
9. **PRC delivery**: Vercel-only launch with client-side latency beacons; Tencent Cloud Shenzhen mirror deferred until p95 > 350ms observed
10. **Custom domain required day 1** — `*.vercel.app` is DNS-poisoned in mainland China. **Domain: `gdo.ax0x.ai`** (sibling subdomain to scorer at `gd.ax0x.ai`; "o" = online)
11. **Tribute defaults**: tournament rule baseline (server auto-picks tribute card; "贡左还右" direction; 还贡 ≤10 cap with smallest-card fallback); casual variants surfaced as room rule axes
12. **Anti-cheat v1**: Rate limiting (5s sliding window) + IP throttle (5 accounts/IP/24h) + report button + admin dashboard + Vercel BotID. ~340 LOC, ~5-6 days.
13. **6P/8P sweep tribute** (2026-05-17): in 2-teams-of-N modes (6P 2-of-3, 8P 2-of-4), if winning team takes all top-N positions, losers tribute by rank order pairing (8→1, 7→2, 6→3, 5→4 for 8P sweep). Mixed-team finishes still use Path A single末→头 tribute. 4-teams-of-2 mode never triggers sweep tribute (mathematically impossible).
14. **换牌 card-exchange optional rule** (2026-05-17): OFF by default; if enabled, losing team votes after round-end (>50% pass), then after tribute every player picks 3 cards which pass to neighbor in server-RNG'd direction (CW/CCW). New EXCHANGE-1 milestone in P3, ~3-4 days work.

15. **AI tier ladder reduced to Easy + Medium for v1** (2026-05-19, SUPERSEDES headline #2 + decision #7 above): the LLM Hard tier was removed because (a) the original research direction was algorithmic / NN, not LLM (5 reference engines surveyed in `ai-strategies.md` are all rule-based / MCTS / NN), and (b) LLM latency 1.5-3s/move × 3 Hard bots × 30 tricks ≈ 3 minutes/game of cumulative wait — structural, not tuneable. Hard tier returns post-WASM via the Bobgy `poker-guandan-strategy` solver with deeper search depth (same engine, depth params produce tier separation). DanLM Master tier still deferred to v1.1.

16. **Per-app Upstash + AUTH-2 cancelled** (2026-05-19, SUPERSEDES decision #8 above + `cross-project-integration.md`): the Vercel Marketplace integration auto-provisioned an independent Upstash for guandan-online (separate from sibling scorer's Redis). Accepted: per-app namespace, no profile sync, no shared key space. **AUTH-2 milestone (migrate scorer's `player:*` → `gs:player:*`) is CANCELLED** — the two projects no longer share key space. Independent redis means gdo failures don't cascade to scorer.

## Recommended AI strategy

Use **different engines per difficulty tier** (NOT same engine + varying search depth — partner card games are about judgment, not lookahead):

| Tier | Engine | Behavior | Latency | Source |
|---|---|---|---|---|
| **入门 (Easy)** | Rule-based + 30% noise | Plays valid moves preferring smallest combos. Will occasionally play sub-optimal. | <20ms | `zdhgg/Guandan-training/autoGrouper.ts` |
| **进阶 (Medium)** | Rule-based + WASM solver + partner awareness | "Rounds-to-empty-hand" optimization; defers to partner if partner is leading. | <80ms | + `Bobgy/poker-guandan-strategy` WASM |
| **高手 (Hard)** | LLM (DeepSeek) candidate pre-filter | Engine emits 5-10 legal candidates with reasoning; LLM picks. Chinese system prompt. | <3s | Vercel AI Gateway |
| **大师 (Master)** | DanLM neural net | Top human-amateur strength. **Deferred v1.1.** | ~3s | macOS .so → Linux unresolved |

**6/8-player mode**: only Easy + Medium ship v1. No surveyed AI handles 6/8 partnership well.

**Player assistance** (auto-sort + suggested moves + endgame solver) shares the same engine — single source of truth in `lib/ai/engine.ts`. Client-side WASM for instant feedback. Disabled in ranked mode (v2).

## Recommended UX direction

- **Orientation tier 1 (Android)**: native `screen.orientation.lock()` after `requestFullscreen()`
- **Orientation tier 2 (iOS Safari)**: CSS `transform: rotate(90deg)` on root + JS-set `--logical-w/h` CSS vars
- **Orientation tier 3 (last resort)**: rotate-prompt overlay (only if CSS rotate fails on specific device)
- **Table layout** (landscape):
  - 4-player: bottom (me) / top (partner pill) / left + right (rivals). Center = trick area.
  - 6-player: bottom + 1 partner indicator / top arc of 3 / 1 each side.
  - 8-player: bottom (me) / top arc of 5 / 1 each side.
- **Hand display**: straight overlap row, 28px visible per card, ≥12px corner rank. 27 cards fits iPhone 14 Pro landscape (390 × 844 → 797 × 335 playfield). Two-row fallback for < 5.5" screens.
- **Interaction**: tap-to-lift → confirm via "出牌" button. NOT single-tap-to-play, NOT drag-to-play.
- **Auto-arrange (理牌)**: persistent button, smart grouping by combo type (not by suit). Manual trigger, doesn't fire automatically.
- **Heart-level wildcard**: always-visible gold edge + ★ badge. Substitution declared via popup when played.
- **Tribute UI**: full-screen modal overlay, 400-600ms card-slide animation, 抗贡 banner state when applicable.

Visual style: technical + premium (Linear / Vercel / Bloomberg / Anthropic). 10 hi-fi wireframes in `demos/index.html` show the envisioned shape.

## Reusable assets inventory

### From sibling `../guandan-scorer/`
- Upgrade calculation: `src/game/calculator.js`
- A-level state machine: `src/game/rules.js`
- 4/6/8 mode constants: `src/core/config.js`
- Settings drawer + room codes pattern
- `validateOwnershipToken` 10-line function (copy verbatim per cross-project plan)
- Upstash KV patterns (`api/rooms/*` + `api/players/*`)
- Player profile schema + achievement system (will share via Option B)

### From `hash-panda/guandan-guide` (license check pending)
- Card type recognition: `cards.ts`
- Pattern matching: `patterns.ts`
- Bomb comparison: `bombPower()`

### From `zdhgg/Guandan-training` (MIT)
- `autoGrouper.ts` (38KB) — hand decomposition heuristics
- `ruleValidator.ts` (26KB) — move legality
- `cardEngine.ts` — engine core

### From `Bobgy/poker-guandan-strategy`
- C++ → WASM solver with red-heart-wildcard search
- Already deployed as PWA, runnable in browser

### From `dengweiqh/guandan-windows` (Apache-2.0, patterns only)
- 4-tier AI Web Worker architecture (we run server-side)
- Dealing animation choreography
- Tribute phase UI flow
- Rule presets pattern

## Key risks (ranked)

1. **Hidden-state glue is hand-written**. Vercel SSE+POST needs centralized `buildClientPayload(playerId, eventType, payload)` filter function with TypeScript exhaustiveness check + grep-test asserting no `redis.publish(` exists outside that one file. This is the most security-critical code in the codebase. Mitigation: per realtime-sync-deep-dive.md §7, treat as non-negotiable PR-review item.

2. **GFW interference with SSE long-connections** (PRC users). Stateful firewall idle timeout ~60-120s closes SSE streams. Mitigation: send SSE keepalive comment every 20-30s. Long-polling fallback after 2 SSE resets within 60s.

3. **AI Hard tier quality is unverified for partnership play**. LLM may make obviously dumb plays that ruin games for human partners. Mitigation: candidate-mode prompt (engine generates legal moves, LLM only picks) bounds catastrophic errors but caps ceiling. Quality bar test via Elo bench (Easy ↔ Medium ↔ Hard should show ~200 Elo gap each); if Hard < Medium, ship with Hard hidden until DanLM v1.1.

4. **PRC GFW tail risk** — 2025-08-20 incident blanket-RST'd all port 443 for 74 minutes. No software mitigation; only path is PRC mirror on Tencent Cloud. Acceptable as a residual risk for v1 (game pauses + reconnects when GFW recovers).

5. **CSS rotate edge cases on iOS**. WebKit rotation bugs surface on specific device/OS combos. Mitigation: 3-5 days test matrix (iPhone SE / 14 Pro / iPad / Pixel) before launch. Rotate-prompt fallback for any device that fails.

6. **8-player hand size policy** (108 ÷ 8 = 13.5). Regional variation. Mitigation: room-configurable (13 or 14 cards; 4 leftover cards go to host / discard pile / random).

7. **27-card hand on small landscape phones** (iPhone SE / older Android < 5.5"). Mitigation: two-row hand fallback when `vw < 600px`.

8. **DanLM platform lock-in**. macOS .so files only. Mitigation: open issue with author before v1.1 planning begins. Defer if unresolved.

9. **License check pending** for `hash-panda/guandan-guide` (no stated license on repo). Mitigation: verify before adopting code; if license unclear, port semantics not source.

10. **Collusion detection is intractable at personal-project scale** (anti-cheat-deep-dive.md §3). v1 logs everything passively; statistical detection only viable at 5000+ games. Accept as residual risk for casual mode.

## Remaining open questions (minor — can resolve in plan phase)

1. **Frontend framework**: React confirmed. TypeScript-only is on the table but **default to React**.
2. **Match persistence**: ephemeral rooms (game ends → state gone) + post-game stats sync to shared profile (per cross-project Option B).
3. **Spectator mode**: yes, read-only spectators in v1 (Lichess pattern). Limited to game public state; no view into player hands.

## v1 implementation milestones (loose-list — plan phase will sequence)

Using `<MILESTONE>-N: description` naming convention:

**Foundation**:
- **CORE-1**: Rules engine — port `hash-panda/guandan-guide` + add scorer's progression layer + unit tests covering tribute / wildcard / bomb hierarchy
- **CORE-2**: Game state machine — deal → trick → tribute → round-end → game-end with all rule axes from `tribute-ux-deep-dive.md`
- **NET-1**: Vercel SSE+POST + Upstash Redis transport layer + `MessageType` enum per realtime-sync-deep-dive.md §7
- **NET-2**: Idempotency keys + `Last-Event-ID` resume + 270s proactive SSE rotation
- **NET-3**: Hidden-state filter (`buildClientPayload` + grep test) — security-critical, PR-gated

**UI**:
- **UI-1**: Card primitive + hand row + trick area (already prototyped in `demos/`)
- **UI-2**: 4-player table + landscape layout + CSS rotate mechanism
- **UI-3**: Room creation + lobby + room browser
- **UI-4**: Tribute phase UI (per tribute-ux-deep-dive.md UI spec)
- **UI-5**: 6/8-player layouts
- **UI-6**: Round-end / A-level / victory screens

**Auth + Cross-project**:
- **AUTH-1**: Copy `validateOwnershipToken` from scorer + handle namespace setup
- ~~**AUTH-2**: Migrate scorer's `player:*` → `gs:player:*` keys~~ — **CANCELLED 2026-05-19** (per-app independent Upstash; no shared key space; see decision #16)

**AI**:
- **AI-1**: Easy + Medium engines inline (rule-based + WASM)
- ~~**AI-2**: LLM Hard tier via DeepSeek + candidate pre-filter~~ — **DELETED 2026-05-19** (LLM latency structural, not tuneable; Hard returns post-WASM via deeper Bobgy search depth; see decision #15)
- **AI-3**: Player assistance — auto-sort + suggest + wildcard substitution UI
- **AI-4**: Mid-game DC takeover (60s grace → bot promotes)

**Anti-cheat baseline**:
- **SEC-1**: Rate limiting via `@upstash/ratelimit` (5s sliding window across all routes)
- **SEC-2**: IP-based account creation throttle + same-room same-IP warning
- **SEC-3**: Report button + admin dashboard (gated by ADMIN_TOKEN env)
- **SEC-4**: Vercel BotID integration on `/api/*`

**PRC delivery**:
- **DEPLOY-1**: Custom domain + DNS + SSL on Vercel
- **DEPLOY-2**: Client-side latency beacons → Upstash counter for p50/p95 monitoring
- **DEPLOY-3** (deferred, conditional): Tencent Cloud Run Shenzhen mirror + Vercel Edge Middleware geo-routing if p95 > 350ms observed

**Polish (v1.1+)**:
- **POLISH-1**: Animations (deal cascade / trick arc / level-up celebration)
- **POLISH-2**: Sound design (card play / shuffle / victory)
- **POLISH-3**: Ranked mode + Elo ladder
- **POLISH-4**: DanLM Master tier (gated on Linux deployment resolution)

Estimated rough work effort for v1 (excluding polish): **6-10 weeks full-time** for a single engineer. Cross-functional milestones (auth + cross-project) front-loaded for unblocking.

---

## Per-stream references

Phase 1 (foundation):
- [`ai-strategies.md`](ai-strategies.md) — 5 AI engines compared
- [`game-rules.md`](game-rules.md) — complete ruleset
- [`existing-implementations.md`](existing-implementations.md) — open-source impls + commercial UX
- [`architecture-options.md`](architecture-options.md) — realtime stacks (locked to Vercel SSE+POST)
- [`mobile-landscape-ux.md`](mobile-landscape-ux.md) — orientation + table layouts

Phase 2 (deep dives):
- [`realtime-sync-deep-dive.md`](realtime-sync-deep-dive.md) — Lichess analog + prescriptive Vercel SSE+POST spec
- [`ai-implementation-plan.md`](ai-implementation-plan.md) — per-tier pseudocode + player assistance + Elo bench
- [`tribute-ux-deep-dive.md`](tribute-ux-deep-dive.md) — 进贡/还贡/抗贡 fully specified across 4/6/8 modes
- [`card-visual-assets.md`](card-visual-assets.md) — Unicode + Geist verdict
- [`china-network-deployment.md`](china-network-deployment.md) — PRC reachability + Tencent Cloud fallback
- [`anti-cheat-deep-dive.md`](anti-cheat-deep-dive.md) — account-level + collusion + scripted-client
- [`cross-project-integration.md`](cross-project-integration.md) — sibling scorer integration (Option B)

Total: ~8,200 lines / ~65K words across 13 documents.
