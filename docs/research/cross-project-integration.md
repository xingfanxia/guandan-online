# Cross-Project Integration: guandan-online × guandan-scorer

> ## SUPERSEDED — 2026-05-19
>
> **This entire document and its Option B (shared @handle namespace) recommendation are SUPERSEDED.**
>
> What changed: the Vercel Marketplace integration auto-provisioned an independent Upstash Redis for guandan-online (separate instance from sibling scorer's Redis). Accepted reality: per-app namespace, no profile sync, no shared key space. The AUTH-2 milestone that was scoped here (migrate scorer's `player:*` → `gs:player:*`) is **CANCELLED** — there's no shared namespace to keep clean.
>
> Rationale: hobby-scale project doesn't need cross-app identity continuity; independent Redis means gdo failures don't cascade to scorer. Online still copies sibling's 10-line `validateOwnershipToken` for handle ownership semantics (pure function — no cross-app reads needed).
>
> See `docs/research/SUMMARY.md` decisions #15 + #16 for the full reasoning. The text below is preserved as historical context only — **do not implement anything described here**.

---

**Date**: 2026-05-16  
**Status**: ~~Research document — written before plan phase. Informs the design doc.~~ **SUPERSEDED 2026-05-19 (see above).**
**Sibling scorer production URL**: gd.ax0x.ai  
**Scorer KV schema source of truth**: `../guandan-scorer/docs/architecture/KV_SCHEMA.md`  
**Scorer player API source of truth**: `../guandan-scorer/api/players/_utils.js` (`initializePlayerStats`)

---

## Context

`guandan-scorer` is a 5,500+ line production app (deployed at gd.ax0x.ai) that ~thousands of real players use for in-person scoring. It has a fully operational `@handle` identity system, career stats, 14 honors, 20 achievements, community voting, partner/rival tracking, and profile photos. It runs on Vercel Functions + Upstash KV.

`guandan-online` will be the actual real-time multiplayer game: Vercel SSE+POST + Upstash KV, per SUMMARY.md decisions (2026-05-16). Players will also need an `@handle` identity. The question is how tightly these two identities should connect.

This document maps the full option spectrum, their user-facing and technical implications, and makes a concrete recommendation.

---

## 1. Conceptual Integration Options — Spectrum from Independent to Merged

Five options, arranged from zero coupling to full product merge.

### Option A: Fully Independent

Two completely separate `@handle` namespaces, two separate Upstash KV instances (or separate key namespaces with no cross-reading), no shared APIs, no cross-app stats. A player's scorer identity and online identity have no technical relationship.

### Option B: Shared Handle Namespace

One `@handle` is valid in both apps. A player who created `@axiang` in the scorer can log into guandan-online using the same handle and token, without re-registering. Stats are stored separately per app — scoring career and online career are independent ledgers — but the player's name, photo, and emoji are the same object.

### Option C: Shared Handle + Cross-App Stats

Same as Option B, but online session results flow into the scorer profile's career counters. Playing 10 online rounds updates `sessionsPlayed`, `avgRankingPerSession`, and `recentRankings` in the shared profile. The scorer shows a unified career view spanning in-person and online sessions.

### Option D: Shared KV Instance (Same Keys)

Implementation-layer variant of C. Both apps read and write the same `player:{handle}` key in the same Upstash instance. No separate namespacing — a write from guandan-online directly overwrites the same JSON blob the scorer reads. Schema versioning carries the full burden of compatibility.

### Option E: Merged Product

One codebase, one domain, two modes: "in-person scoring" (current scorer functionality) and "online play" (new multiplayer). The scorer's existing 40-module architecture is absorbed into the new project. Players see a unified product.

---

## 2. User-Facing Implications of Each Option

Take a concrete example: a guandan-scorer user has created `@axiang`, played 50 in-person sessions, earned honors (吕布 × 3, 石佛 × 2), and has a profile photo. They want to play guandan-online.

| Option | What happens when @axiang signs up for online |
|---|---|
| **A** | Must create a new online account. If the handle `axiang` is already taken online, they must pick a new one. Their 50 sessions, honors, and photo are invisible to online. Two separate identities, zero shared recognition. |
| **B** | Clicks "log in with scorer account" on guandan-online. Their handle, display name, emoji, and photo transfer instantly. No re-registration friction. Online career starts at zero but identity is consistent. If another player squatted `axiang` online, @axiang from scorer must contact support or pick a new name. |
| **C** | Same instant login as B. Additionally, after each online session, @axiang's scorer profile gains the session result — their scorer career page will show online wins mixed into the in-person history, with a mode indicator. Partner/rival relationships from online play surface in the scorer's partner chart. |
| **D** | Same UX as C from the player's perspective; the difference is implementation (shared KV keys vs. separate + sync). Risk: a botched write from one app corrupts the profile visible in both. |
| **E** | The scorer app stops being a separate URL. Existing users are redirected to the merged product. UX change is dramatic — the scorer's existing layout (scoreboard, history panels, pool/slots, five themes) must coexist with the game's landscape-first card table. Both user bases must learn a new navigation model. |

**Friction ranking** (lowest first): B ≈ C < A < D (user doesn't see the diff) < E (product disruption)

**Identity continuity ranking** (best first): C = D > B > A > E (E resets UX even if data persists)

---

## 3. Technical Implications

### Option A: Fully Independent

| Dimension | Detail |
|---|---|
| **Auth model** | Online invents its own token issuance at account creation. The scorer's `ownershipToken` (issued by `../guandan-scorer/api/players/create.js`, stored as SHA-256 hash) is unrelated. |
| **Handle uniqueness** | Per-app. `axiang` can exist in scorer's KV and online's KV simultaneously as different people. |
| **KV schema** | Separate Upstash projects or same instance with distinct prefixes (`gs:player:axiang` vs `go:player:axiang`) but no cross-reading. |
| **API endpoints** | Completely separate. Scorer's `api/players/*` does not talk to online, and vice versa. |
| **Deployment** | Two independent Vercel projects. No shared environment variables except possibly same Upstash instance URL (for cost reasons). |
| **Migration complexity** | Zero. Existing scorer profiles are untouched. Online starts fresh. |

### Option B: Shared Handle Namespace

| Dimension | Detail |
|---|---|
| **Auth model** | Online's sign-in flow calls scorer's `GET /api/players/{handle}` to check existence, then issues a cross-app JWT. Or: both apps share the same Upstash instance and the ownership token hash in `gs:player:{handle}` is used directly — online validates against that key. |
| **Handle uniqueness** | Global. The handle `axiang` can only be "owned" by one person. Online's sign-up flow must reject a new registration if `gs:player:axiang` already exists. Online's namespace should be treated as a subset of scorer's namespace (scorer = source of truth for handle allocation). |
| **KV schema** | Shared Upstash instance, separate prefixes: scorer writes `gs:player:axiang`, online writes `go:player:axiang`. The handle is the join key. Profile identity fields (displayName, emoji, photo) are stored in `gs:profile:axiang` (shared read) or duplicated at sign-up time in `go:player:axiang`. |
| **API endpoints** | Online's sign-up calls scorer's profile API to check handle availability. Online's session does NOT write to `gs:*` keys. |
| **Deployment** | Two separate Vercel projects sharing one Upstash project. `KV_REST_API_URL` and `KV_REST_API_TOKEN` are the same env vars in both projects. |
| **Migration complexity** | Low on scorer side (no schema change). Moderate on online side (must implement handle-existence check against `gs:player:*` keys on sign-up). One-time migration: copy identity fields to a `shared:identity:*` namespace (optional; see Section 5). |

### Option C: Shared Handle + Cross-App Stats

All of Option B's technical constraints, plus:

| Dimension | Detail |
|---|---|
| **Auth model** | Same as B. |
| **Stats write path** | After an online session ends, guandan-online calls scorer's `PUT /api/players/{handle}` with a game result. This is the same endpoint used by scorer's own `syncProfileStats()` (wired in `../guandan-scorer/src/api/playerApi.js`). OR: online writes directly to `gs:player:axiang` with proper schema merge logic, bypassing scorer's API. The API-proxy approach is safer (scorer's merge logic is battle-tested). |
| **Schema compatibility** | Online sessions produce results that must map to scorer's `initializePlayerStats()` shape (defined in `../guandan-scorer/api/players/_utils.js` lines 115–193). Fields like `sessionsPlayed`, `avgRankingPerSession`, `recentRankings`, `partners`, `opponents`, and `honors` must be computed from online game data into scorer-compatible format. Online has Elo/level fields scorer doesn't have — those go into `go:player:axiang` only. |
| **Race conditions** | Two apps writing to the same scorer profile record simultaneously is a real risk. If a player finishes an in-person session and an online session at the same time, both apps call `kv.set(`player:axiang`)` — last write wins, silently dropping one session's data. Upstash KV doesn't offer atomic read-modify-write (no Redis WATCH/MULTI from the REST API). Mitigation: optimistic locking via a `version` field; retry on conflict. |
| **Migration complexity** | High. Scorer's `PUT /api/players/{handle}` endpoint (`../guandan-scorer/api/players/[handle].js`) is 947 lines with complex merge logic. Online must produce a compatible `gameResult` payload, match the honor calculation contract, and handle the mode-specific stats split (`stats4P`, `stats6P`, `stats8P`). |

### Option D: Shared KV Instance (Same Keys)

All of C's complexity, plus:

| Dimension | Detail |
|---|---|
| **Schema governance** | Both apps write to `player:{handle}` (same key, no prefix separation). Adding an online-only field (e.g., `eloRating`) mutates the same JSON blob the scorer reads. Any schema change in either app potentially breaks the other. |
| **Risk surface** | A bug in online's write path can corrupt a scorer profile that a player has built up over 50+ sessions. No key separation means no rollback isolation. |
| **Mitigation** | Strict schema versioning field (`schemaVersion`) + both apps must validate and migrate on read. Complex at solo-project velocity. |

### Option E: Merged Product

| Dimension | Detail |
|---|---|
| **Auth model** | Single auth system, likely upgrades scorer's ownership-token model to something more robust (session cookies, or Clerk). |
| **Handle uniqueness** | Trivially unified — one app, one namespace. |
| **KV schema** | Unified. One key covers both in-person and online. |
| **Deployment** | One Vercel project. Significant refactor of scorer's Vite + vanilla JS to align with online's planned React + TypeScript stack. |
| **Migration complexity** | Very high. The scorer is a 40-module vanilla JS app; online is planned as React + TypeScript. Merging the two codebases is a multi-week project with high regression risk for the production scorer. |

---

## 4. Trade-Offs Analysis

| | A: Independent | B: Shared Handle | C: Shared Stats | D: Shared Keys | E: Merged |
|---|---|---|---|---|---|
| **User friction at sign-up** | High (re-register) | Low (instant SSO) | Low | Low | n/a (no separate sign-up) |
| **Identity consistency** | None | Good | Excellent | Excellent | Excellent |
| **Scorer migration needed** | None | Minimal | Moderate | High | Huge |
| **Online build complexity** | Lowest | Low | High | Very High | Extreme |
| **Data corruption risk** | None | Low | Medium | High | Low (one codebase) |
| **Race condition risk** | None | None | Medium | High | Low |
| **Schema entanglement** | None | Low | Medium | High | n/a |
| **Feature velocity (online)** | Highest | High | Medium | Low | Very Low |
| **Username squatting risk** | None | Yes | Yes | Yes | n/a |
| **Solo-project maintenance** | Excellent | Good | Acceptable | Hard | Very Hard |

**Honest assessment of Option B's downsides:**

- **Username squatting**: A scorer user named `axiang` who never plays online blocks anyone else from being `@axiang` in the online game. This is the same tradeoff GitHub/Twitter make (squatters exist). At this project's scale (likely hundreds to low-thousands of concurrent users), it is a cosmetic annoyance, not a system-design problem.
- **Schema migration**: Scorer profiles don't have online-specific fields (Elo, `goSessionsPlayed`, level progression in the online sense). They don't need to — those go into `go:player:{handle}` with a completely separate schema. Option B does NOT require any scorer schema changes.
- **Cross-app write race conditions**: Option B does NOT have this problem because stats stay in separate namespaces. This is C and D's issue, not B's.

---

## 5. KV Namespacing Options

### If using a shared Upstash instance (recommended):

| Key pattern | Owner | Purpose |
|---|---|---|
| `gs:player:{handle}` | guandan-scorer | Full scorer profile (stats, honors, achievements, photo, etc.) |
| `gs:player_id:{id}` | guandan-scorer | Reverse ID lookup |
| `gs:room:{code}` | guandan-scorer | In-person room state |
| `go:player:{handle}` | guandan-online | Online-specific profile (Elo, `goSessionsPlayed`, online level, etc.) |
| `go:room:{code}` | guandan-online | Online room/game state (card hands, round state) |
| `go:session:{sessionId}` | guandan-online | Individual game session for reconnect + replay |
| `shared:identity:{handle}` | whichever creates first | Display name, emoji, photoBase64, tagline — the fields both apps show in UI |

The `shared:identity:{handle}` key is optional. Option B can work without it: when online creates a new profile, it copies identity fields from `gs:player:{handle}` (if the player is a scorer user) into `go:player:{handle}` at sign-up time, and doesn't re-read scorer's profile during normal operation.

### If using separate Upstash instances:

No key collision is possible by construction. Cross-app queries require an HTTP call from one project to the other's API. Scorer does not need to know online exists; online calls scorer's public `GET /api/players/{handle}` to check handle availability and retrieve identity at sign-up.

Separate instances add a small monthly cost but provide clean blast-radius isolation: a botched migration in online's KV cannot touch scorer's data.

### Concrete key examples (shared instance, Option B):

```
# Scorer profile (unchanged from current scorer schema)
gs:player:axiang  →  { "handle": "axiang", "displayName": "阿祥", "emoji": "🐲",
                       "stats": { "sessionsPlayed": 50, "honors": { "吕布": 3, ... }, ... },
                       "recentGames": [...], "ownershipTokenHash": "a3f5...", ... }

# Online profile (new, online-specific fields only)
go:player:axiang  →  { "handle": "axiang", "displayName": "阿祥", "emoji": "🐲",
                       "eloRating": 1423, "goSessionsPlayed": 12, "goSessionsWon": 7,
                       "onlineLevel": 6, "recentOnlineGames": [...],
                       "ownershipTokenHash": "b7c1..." }

# Online game state (ephemeral, TTL 4h)
go:room:K9X3T7   →  { "roomCode": "K9X3T7", "players": ["axiang", "bot_medium_1", ...],
                       "hands": { "axiang": ["2H","3H",...], ... },
                       "phase": "trick", "currentTrick": [...], ... }

# Online session for reconnect (TTL 2h)
go:session:s_axiang_1747395600  →  { "sessionId": "...", "handle": "axiang",
                                     "roomCode": "K9X3T7", "joinedAt": "..." }
```

Current scorer uses bare `player:{handle}` keys (no prefix) — see `../guandan-scorer/api/players/list.js` line 43 (`kv.keys('player:*')`) and `../guandan-scorer/api/players/create.js` line 98 (`kv.set(`player:${handle}`, ...)`). Migration to `gs:player:*` keys would be a one-time rename operation, required if we share the same Upstash instance to avoid key collision with online's own `player:*` keys.

---

## 6. Auth Bridging — How to Actually Do Shared @Handle

The scorer's auth model (per `../guandan-scorer/api/players/_utils.js` lines 247–257) uses a 32-byte random token issued once at profile creation, stored client-side in localStorage, and validated server-side by comparing its SHA-256 hash against `ownershipTokenHash` in the KV record. The raw token is shown once at creation and never recoverable.

Three viable approaches for bridging this to guandan-online:

### Approach 1: Direct Token Verification via Shared KV

Online reads `gs:player:{handle}` from the shared Upstash instance and validates the provided ownership token against `ownershipTokenHash` using the same SHA-256 comparison logic. Online never calls scorer's API — it reads the KV key directly.

```
User visits guandan-online sign-in
→ enters @handle + ownership token
→ online reads gs:player:{handle} from shared KV
→ SHA-256(provided_token) == ownershipTokenHash? → authenticated
→ online writes go:player:{handle} if first login (copies identity from gs:player)
→ issues its own online session (httpOnly cookie or localStorage token)
```

**Pros**: No API dependency on scorer. Works even if scorer is down.  
**Cons**: Online must implement the same SHA-256 hash comparison from scratch (trivial — it's 10 lines). Online has direct KV read access to scorer's full profile blob, including sensitive fields (ownershipTokenHash). Mitigated by sharing the Upstash instance read/write token only with controlled server-side code (Vercel Functions only, never exposed to client).

### Approach 2: Cross-App JWT via Scorer's API

Scorer exposes a new endpoint `POST /api/auth/issue-cross-app-token`. Online calls this endpoint with the user's handle + ownership token; scorer validates and returns a short-lived JWT (15-minute TTL, signed with a shared `CROSS_APP_SECRET` env var). Online consumes the JWT to establish an online session.

```
User visits guandan-online sign-in
→ enters @handle + ownership token
→ online sends: POST gd.ax0x.ai/api/auth/issue-cross-app-token
    { handle: "axiang", ownershipToken: "..." }
→ scorer validates token, returns signed JWT (15 min TTL)
→ online verifies JWT signature with shared CROSS_APP_SECRET
→ online writes go:player:{handle} if first login
→ issues its own online session
```

**Pros**: Online never touches scorer's KV directly. Clean API boundary. Scorer controls token issuance.  
**Cons**: Adds a new endpoint to scorer (1-2 hours of work). Online depends on scorer's API being available at sign-in. A scorer outage blocks new online sign-ins.

### Approach 3: Separate Online Accounts, Optional Link

Online has completely independent account creation. A "Link scorer account" feature lets users optionally prove ownership of a scorer handle (same token exchange as Approach 2) and get a badge or shared display name. Stats remain fully separate.

**Pros**: Zero scorer changes in v1. Zero auth dependency.  
**Cons**: Doesn't solve the username squatting or identity friction problems at all. Effectively Option A with a cosmetic link button.

**Simplest path that works**: Approach 1 (Direct Token Verification via Shared KV). It requires zero changes to scorer's existing API, works offline from scorer's perspective, and the 10-line hash comparison is already implemented as `validateOwnershipToken` in scorer's `_utils.js` — copy it verbatim into online's auth module.

---

## 7. Recommendation

**Recommended option: B (Shared Handle Namespace) via Approach 1 (Direct KV Token Verification), with Option C (cross-app stats sync) deferred to v1.2.**

### Rationale

Option B provides the highest user-facing value at the lowest implementation cost:

- Existing scorer users — the target early adopters for online play — get zero-friction access. They enter their existing `@handle` and ownership token and are in.
- No scorer schema changes are needed. Scorer's `gs:player:*` keys are read-only from online's perspective during sign-in.
- Online's profile (`go:player:*`) starts fresh with online-specific fields (Elo, online session history, online level) that scorer neither needs nor should know about.
- The one-time scorer migration (renaming bare `player:*` keys to `gs:player:*`) is a clean operation that can be done with a migration script before online launches. It does not change scorer's user-facing behavior.
- Cross-app stat sync (C) is the compelling long-term vision — a single "career" that spans in-person and online — but it requires solving the race condition problem and producing a stats payload that is compatible with scorer's 947-line merge logic in `[handle].js`. That is v1.2 work.

### What Option B does NOT require:

- No changes to scorer's existing player API endpoints.
- No changes to scorer's KV schema (beyond the key prefix migration).
- No new scorer API endpoints (auth bridging uses direct KV read).
- No React / TypeScript changes to scorer.

---

## 8. Implementation Work in Sibling Scorer

To support Option B, three tasks are needed in guandan-scorer:

### Task 1: KV Key Prefix Migration (~4 hours)

Rename all bare `player:{handle}` and `player_id:{id}` keys to `gs:player:{handle}` and `gs:player_id:{id}` in the shared Upstash instance.

Files to update:
- `../guandan-scorer/api/players/create.js` — `kv.set(`player:${handle}`, ...)` → `kv.set(`gs:player:${handle}`, ...)`
- `../guandan-scorer/api/players/[handle].js` — all 13 occurrences of `kv.get/set(`player:...`)` (lines 288, 307, 337, 397, 423, 464, 496, 520, 868, 915)
- `../guandan-scorer/api/players/list.js` — line 43: `kv.keys('player:*')` → `kv.keys('gs:player:*')`
- `../guandan-scorer/api/players/touch.js`, `delete.js`, `reset-stats.js`, `migrate-modes.js` — any direct KV key references
- One-time data migration script: scan all `player:*` keys, copy to `gs:player:*`, delete originals. Run once, verify, then update code.

**Risk**: This is a production migration on a live app. Deploy with a feature flag: run both `player:*` and `gs:player:*` reads in parallel (read from new key, fall back to old key) until migration is complete and verified.

### Task 2: Expose `validateOwnershipToken` Logic for Online Reuse

No new endpoint needed. Online replicates the 10-line `validateOwnershipToken` function from `../guandan-scorer/api/players/_utils.js` (lines 259–277) into its own auth module. This function is pure crypto — no external dependencies, no scorer API calls required.

### Task 3: Update CLAUDE.md to Document Shared Namespace

Add a section to `../guandan-scorer/CLAUDE.md` documenting:
- KV keys now use `gs:` prefix for scorer data.
- `go:` prefix is reserved for guandan-online.
- Upstash instance is shared with guandan-online.
- Cross-app sign-in flow (Approach 1).

**Estimated effort in scorer**: 1 day (migration script + code update + CLAUDE.md documentation).  
**Estimated effort in online**: 1 day (auth module with shared KV read + handle existence check at sign-up).  
**Total**: ~2 days of integration work across both projects.

---

## 9. Cross-App Stat Sync (Deferred to v1.2)

When this is eventually implemented, the recommended architecture:

**Online session complete → scorer profile update flow:**

```
1. Online game ends (last trick played, winner determined)
2. guandan-online calculates session result:
   - Relative rankings (1–N per player)
   - Session duration
   - Honor assignments (reuses scorer's honor algorithm, ported to TypeScript)
3. Online writes to go:player:{handle} (its own namespace)
4. For each player with a linked scorer handle:
   - POST gd.ax0x.ai/api/auth/sync-online-session
     { handle: "axiang", sessionResult: { ... } }
     (signed with CROSS_APP_SECRET)
5. Scorer's new endpoint validates signature, calls existing merge logic (same path as
   syncProfileStats in src/api/playerApi.js → PUT /api/players/{handle})
6. Idempotency: include online sessionId in payload; scorer checks
   stats.syncedOnlineSessions (new field) before applying — prevents double-count on retry.
```

**Redis Streams alternative (pub/sub, no polling):**

```
Online session complete → XADD cross-app:sessions-completed * sessionId ... handle ...
Scorer cron (every 5 min) → XREAD from cross-app:sessions-completed → processes batch
```

This is more elegant but requires scorer to run a cron job (Vercel Cron), adds operational complexity, and is not needed until the cross-app stats feature is actually wanted by users. The API-proxy approach above is simpler and gives scorer explicit control over what it applies.

**Schema additions needed in scorer for v1.2:**

- `player.stats.syncedOnlineSessions: string[]` — array of online session IDs already applied (idempotency guard)
- `player.stats.onlineStats: { sessionsPlayed, sessionsWon, eloAtLastSync }` — separate online counters (so scorer's in-person stats aren't polluted by online data unless user opts in to unified view)
- New scorer API endpoint: `POST /api/auth/sync-online-session` — accepts signed payload from online, validates CROSS_APP_SECRET, applies to scorer profile

---

## 10. Risk: What If Integration Goes Wrong?

### Risk 1: Profile Corruption (affects both apps)

A shared Upstash instance means a bug in either app's KV write path could damage profiles visible in the other app.

**Mitigation for Option B**: Online only reads `gs:player:*` keys (to validate auth at sign-in). It never writes to them. Its own data lives in `go:player:*`. Corruption risk is near zero — online is read-only against scorer's namespace.

**Mitigation for Option C/D**: Would require the API-proxy approach (online calls scorer's PUT endpoint, not direct KV write). Scorer's merge logic is the single-writer for `gs:player:*`. This doesn't eliminate bugs in scorer's merge logic, but it prevents online from introducing a new write path entirely.

### Risk 2: Upstash Quota Sharing

Both apps sharing one Upstash instance share the 100K commands/day limit on the free tier. Online's real-time game loop (SSE stream updates, move validation, room state reads) is far more KV-intensive than scorer's batch sync model. A single busy online room could generate 200+ KV reads/writes per minute.

**Mitigation**: Separate Upstash projects for game-state (`go:room:*`, `go:session:*`) and profile data (`gs:player:*`, `go:player:*`). Option: put the high-frequency game-state keys in online's own Upstash project, and only the profile namespace is shared with scorer. This is the cleanest isolation: scorer's billing is unaffected by online's game traffic.

### Risk 3: Migration Key Rename on Live App

Renaming `player:*` → `gs:player:*` on a production app with active users is a real operational risk. If the migration script fails midway, some keys exist under both names, some under neither.

**Mitigation**: Use the fallback-read pattern during migration window:
```javascript
// During migration: read new key, fall back to old
const playerData = await kv.get(`gs:player:${handle}`) 
                ?? await kv.get(`player:${handle}`);
```
Run migration script in batches with logging. Verify count before enabling online's auth bridge. Feature-flag the online sign-in behind an env var so it can't be used before migration completes.

### Risk 4: Username Squatting

A scorer user who registered `@axiang` will have that handle reserved in online as well. If they never sign up for online, another person who wants that handle online is blocked.

**Mitigation**: This is a product decision, not a technical one. Options: (a) squatting is accepted (as on GitHub/Twitter); (b) handles unclaimed in online for 6 months after launch become available online-only; (c) online gets a separate namespace with a suffix convention (`axiang_online`). Option (a) is simplest for v1. Revisit at launch.

---

## Summary Table

| | A | B (recommended) | C (deferred v1.2) | D | E |
|---|---|---|---|---|---|
| Scorer changes needed | None | Key prefix migration (~1 day) | + sync endpoint (~1 day) | Large | Rewrite |
| Online auth complexity | Lowest | Low | Low | Low | n/a |
| User sign-up friction | High | None for scorer users | None | None | None |
| Cross-app stats | None | None | Yes | Yes | Yes |
| Race condition risk | None | None | Medium | High | Low |
| Data corruption blast radius | None | None (read-only) | Low (API-proxy) | High | Low |
| Solo-project maintenance | Easy | Easy | Manageable | Hard | Very Hard |
| Recommended for v1 | | **Yes** | | | |
| Recommended for v1.2 | | | **Yes (add on top of B)** | | |
