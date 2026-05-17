# lib/auth — Shared @handle namespace with sibling scorer

This is **Option B** from [`docs/research/cross-project-integration.md`](../../docs/research/cross-project-integration.md):
guandan-online and the sibling guandan-scorer share the same Upstash KV
instance and the same player @handle identity space. A user with `@fufu` in
the scorer is the same `@fufu` in the online game. Profile data (displayName,
emoji, achievements) is shared; per-app game state (rooms, sessions,
ownership tokens) is namespaced by app prefix.

## Key prefixes (Upstash KV)

| Prefix | Owner | Contents |
|---|---|---|
| `gs:player:<handle>` | scorer (after AUTH-2) | player profile, stats, achievements — read by both apps |
| `gs:room:<code>` | scorer | scorer's in-person session rooms |
| `go:player_token:<handle>` | online | hashed ownership token for online self-edits |
| `go:room:<code>` | online | online game room state |
| `go:game:<gameId>` | online | per-game state (deal, trick, level) |

Before AUTH-2 migration, scorer uses bare `player:<handle>`. AUTH-2 introduces
the `gs:` prefix with a fallback-read pattern so existing users continue to
work during rollout. Online never reads the bare `player:` namespace — it
only reads `gs:player:*` (after migration) for shared profile data.

## Files

| File | Source of truth | What it does |
|---|---|---|
| `ownershipToken.ts` | scorer `api/players/_utils.js:247-285` | generate / hash / validate per-user bearer tokens |
| `handle.ts` | scorer `api/players/_utils.js:23-36` | normalize + validate handle format |

Both files carry a `// SYNC:` comment pinning the sibling source. When either
side changes, sync both within the same PR — the format MUST stay byte-identical
or accounts created in one app stop validating in the other.

## Token semantics

- Generated as 256 bits of crypto-random, hex-encoded (64 chars).
- Stored as SHA-256 hex (64 chars). Preimage resistance means a KV leak
  doesn't yield usable tokens — an attacker would need to brute-force 256 bits
  per record.
- Validated in constant time on the hashes (length-equal short-circuit
  cannot become a timing oracle because both inputs are hex of fixed length).
- Defense-in-depth: storedHash length is checked to be exactly 64 chars
  before compare — guards against a future schema change accidentally storing
  raw values.

## Handle format

Currently ASCII-only: `[a-zA-Z0-9_]{3,20}`. Demos show Chinese-named players
like `@阿祥`, but those are `displayName` fields on the profile. The handle
itself (the URL slug, the KV key, the cross-app identifier) is ASCII.

### Open question — Unicode handles

The demos render handles with leading `@阿祥` styling, which is visually
appealing. The sibling scorer's current regex rejects non-ASCII. We could:

1. **Stay ASCII** (current) — cleanest cross-app contract, simplest URL
   handling, but loses the visual identity of Chinese-named players.
2. **Expand both apps to Unicode** — change the regex to `/^[\p{L}\p{N}_]+$/u`
   on both sides simultaneously, allow `@阿祥` as a real handle.

Decision deferred to AUTH-2 PR review. If we go Unicode, the regex changes
on both sides and `api/players/_utils.js` gets updated.

## Caller flow

```ts
// On handle creation
const token = generateOwnershipToken();
const hash = await hashToken(token);
await redis.set(`go:player_token:${handle}`, hash);
// Send `token` to the user once — they store it in localStorage.

// On self-edit request
const provided = extractBearerToken(request);
if (!provided) return new Response('missing token', { status: 401 });
const stored = await redis.get(`go:player_token:${handle}`);
const ok = await validateOwnershipToken(provided, stored);
if (!ok) return new Response('invalid token', { status: 403 });
// proceed with the edit
```
