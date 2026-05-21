# Bobgy WASM Phase A — execution plan

**Status**: Planned 2026-05-21. Ready to execute in a fresh session.

**Goal**: Get Bobgy's `strategy.cpp` compiled to WebAssembly, vendored into
the repo with a prebuilt artifact, exposed via a typed TS wrapper, and wired
into `lib/ai/medium.ts` as the inner-loop hand decomposer (with the existing
heuristic preserved as fallback). Phase B (lookahead policy → Hard tier
revival + UI chip) is a SEPARATE later session.

**Why this is multi-session work**: Phase A touches a third-party C++ codebase,
Emscripten toolchain (via Docker), WASM loader code that has to work in both
the browser (Vite) AND Node (Vitest + server bot run-loop), and partial
integration into the existing AI tier. The first failed compile or load
error can eat several turns. Better to bound this as one focused session
with a clear handoff to Phase B rather than try to cram both into one.

---

## 1. Decisions locked with AX (2026-05-21)

| Question | Decision |
|---|---|
| Source integration | **Vendor source + commit prebuilt `.wasm` artifact**. Copy `strategy.cpp` + `cc/common.{cpp,hpp}` into `lib/ai/decomposer/cpp/` with MIT attribution. Build once locally via Docker `emscripten/emsdk`, commit the resulting `strategy.wasm` + `strategy.js` glue to `lib/ai/decomposer/dist/`. No Emscripten in CI/Vercel. |
| Integration depth | **New `lib/ai/decomposer/` module + thin Medium hook**. Standalone module exposes `decomposeHand(cards, levelRank) -> Decomposition` with sync TS interface. `lib/ai/medium.ts` adds ONE call to use the decomposer's top-cost candidate. Existing rule-based Medium logic (`rankByCoop`) preserved as fallback. |
| Turn cap | **50 turns** for the Phase A /goal loop (aggressive — assumes first Emscripten compile via Docker goes smoothly). |

---

## 2. Upstream source inventory (verified 2026-05-21)

Cloned `Bobgy/poker-guandan-strategy` HEAD (depth-1) to `/tmp/bobgy-source`
for inventory. Three C++ files matter:

| File | LOC | Purpose |
|---|---|---|
| `strategy.cpp` | 430 | DFS solver + `EMSCRIPTEN_BINDINGS` exposing `calc(cards, mainRank, useOverallValueEstimator)` |
| `cc/common.cpp` | 249 | Card parsing + pattern detection helpers |
| `cc/common.hpp` | 96 | Type defs (`THandCards = map<int, multiset<char>>` keyed by rank) + pattern enum + function declarations |
| `LICENSE` | — | MIT, © 2018 Yuan Gong (cite verbatim in our vendored README) |

**Upstream build command** (from Bobgy's `package.json`):
```bash
em++ strategy.cpp cc/common.cpp -o app/public/res/strategy.js \
  -s EXTRA_EXPORTED_RUNTIME_METHODS='["cwrap", "ccall"]' --bind
```

**API exposed**: `calc(cards: string, mainRank: char, useOverallValueEstimator: bool)`
returning `{minHands: double, solutions: vector<string>}`.

**Card string encoding** (per upstream comment on `strategy.cpp:392-394`):
- `?H` heart, `?S` spade, `?C` club, `?D` diamond (? = rank char)
- `XB` small joker (black joker / BJ), `XR` big joker (red joker / RJ)
- Rank `10` → char `0` (single-char encoding for 10)
- All other ranks → their natural char (`2`-`9`, `J`, `Q`, `K`, `A`)
- `mainRank` is a single char (e.g., `'2'`, `'5'`, `'A'`)

**Solution string format**: pipe-separated play groups,
e.g. `"SA SK SQ | H2 H2 | XR XB"`. Each `|` section is one trick play.

---

## 3. Build pipeline

### 3.1 Vendor layout

```
lib/ai/decomposer/
├── README.md                 — MIT attribution + how to rebuild
├── cpp/
│   ├── strategy.cpp          — verbatim from upstream
│   ├── common.cpp            — verbatim from upstream cc/common.cpp
│   ├── common.hpp            — verbatim from upstream cc/common.hpp
│   └── LICENSE-bobgy         — MIT text + © 2018 Yuan Gong
├── dist/
│   ├── strategy.js           — Emscripten JS glue (~14KB)
│   └── strategy.wasm         — compiled WASM (~50-100KB)
├── index.ts                  — public API: decomposeHand() + types
├── encode.ts                 — Card[] → upstream string conversion
├── decode.ts                 — solutions string → structured patterns
└── loader.ts                 — Node-friendly WASM module loader
```

### 3.2 Build script

`scripts/build-wasm.sh` — invokes Docker `emscripten/emsdk` to compile.
Run **manually** (NOT in CI) when `strategy.cpp` or `common.{cpp,hpp}` change:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker run --rm \
  -v "$(pwd)/lib/ai/decomposer:/src" \
  -w /src \
  emscripten/emsdk:latest \
  em++ cpp/strategy.cpp cpp/common.cpp \
    -o dist/strategy.js \
    -s EXTRA_EXPORTED_RUNTIME_METHODS='["cwrap","ccall"]' \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s ENVIRONMENT='node,web' \
    -s ALLOW_MEMORY_GROWTH=1 \
    --bind
echo "Built dist/strategy.js + dist/strategy.wasm"
```

**Key flags differing from upstream**:
- `MODULARIZE=1` — outputs an ES module factory instead of polluting `window.Module` (upstream is browser-only via `<script>` tag + global Module — won't work in Node tests)
- `EXPORT_ES6=1` — clean import shape for our `loader.ts`
- `ENVIRONMENT='node,web'` — Node compat (for vitest + server bot run-loop)
- `ALLOW_MEMORY_GROWTH=1` — safety for unusual hand sizes

**Verify post-build**: `scripts/build-wasm.sh` should produce `dist/strategy.js` + `dist/strategy.wasm`. Commit both. Re-run only when C++ source changes.

### 3.3 Why Docker (not local em++ install)

Emscripten isn't installed on the dev machine. Two options were:
- `brew install emscripten` — adds a system-level dependency for every dev
- Docker `emscripten/emsdk` — zero local install, reproducible version pin

Docker chosen because (a) the build is rare (only when C++ source changes,
which should be never except for upstream upgrades) and (b) avoids
forcing every contributor to install emsdk.

---

## 4. TypeScript wrapper design

### 4.1 Public API (`lib/ai/decomposer/index.ts`)

```typescript
import type { Card } from '../../game/cards.js';
import type { LevelRank } from '../../game/levels.js';

/**
 * One play group from a decomposition (e.g., "SA SH SK" → 3 cards).
 * Cards in the same group form a single legal pattern (or could be played
 * together — caller decides).
 */
export interface DecomposerPlay {
  cards: Card[];
}

export interface Decomposition {
  /** Minimum cost (interpretation depends on which estimator was used). */
  minCost: number;
  /** Ordered list of play groups. First-to-play first. */
  plays: DecomposerPlay[];
}

/**
 * Decompose a hand into the minimum-cost sequence of legal play groups
 * via Bobgy's DFS solver. Sync — completes in single-digit ms for typical
 * 27-card hands.
 *
 * @param hand Cards to decompose. Wildcards (heart-suit level rank) handled.
 * @param levelRank Current trump level (1-char internally).
 * @param useOverallValueEstimator If true, uses Bobgy's value-aware
 *   estimator (prefers preserving high cards). Defaults to MinPlays
 *   estimator (raw hand count).
 */
export function decomposeHand(
  hand: readonly Card[],
  levelRank: LevelRank,
  useOverallValueEstimator?: boolean,
): Decomposition;

/** Ensure the WASM module is loaded. Call once on module init in tests. */
export function preloadDecomposer(): Promise<void>;
```

### 4.2 Encoding (`encode.ts`)

Pure function: `Card[] → string` matching Bobgy's format.

```typescript
import type { Card, Rank, Suit } from '../../game/cards.js';

const SUIT_TO_BOBGY: Record<Exclude<Suit, 'joker'>, string> = {
  spades: 'S',
  hearts: 'H',
  clubs: 'C',
  diamonds: 'D',
};

function rankToBobgyChar(rank: Rank): string {
  if (rank === '10') return '0';
  if (rank === 'BJ') return 'XB'; // special 2-char (joker)
  if (rank === 'RJ') return 'XR';
  return rank; // '2'-'9' + 'J', 'Q', 'K', 'A'
}

export function encodeHand(hand: readonly Card[]): string {
  return hand
    .map((c) => {
      if (c.suit === 'joker') return rankToBobgyChar(c.rank); // 'XB' / 'XR'
      return `${rankToBobgyChar(c.rank)}${SUIT_TO_BOBGY[c.suit]}`;
    })
    .join(' '); // upstream tokenizes on space
}
```

### 4.3 Decoding (`decode.ts`)

Pure function: solution string → `DecomposerPlay[]`.

Pattern: `parseSolutionsUnsafe` from Bobgy's `portCppModule.ts` (already
read in this session) is the reference. Adapt to return our `Card` type
instead of raw strings.

Handle the wildcard restoration trick from Bobgy's `restoreWildCards` —
decomposer output uses placeholder cards for wildcards which need to be
mapped back to actual hearts-of-level-rank cards in our deck.

### 4.4 Loader (`loader.ts`)

Singleton module loader. Loads WASM once, caches instance.

```typescript
import factory from './dist/strategy.js'; // factory exported by MODULARIZE=1

let modulePromise: Promise<CppModule> | null = null;

export async function getCppModule(): Promise<CppModule> {
  if (!modulePromise) {
    modulePromise = factory({
      locateFile: (path: string) => {
        // Node: relative to dist/. Vite: bundler-served.
        if (typeof window === 'undefined') {
          return new URL(`./dist/${path}`, import.meta.url).pathname;
        }
        return path;
      },
    });
  }
  return modulePromise;
}
```

**Risk to monitor**: Vite's WASM handling. May need `import.meta.glob` or
explicit `?init` / `?url` import suffixes. Test in browser via dev server
once Phase A lands, before claiming success.

### 4.5 Why sync `decomposeHand` despite async module load

The solver itself is sync (single-digit ms). Only the WASM module **load**
is async, and that happens once. The wrapper internally awaits the
`getCppModule()` promise on first call OR throws if not preloaded — caller
should `await preloadDecomposer()` once at startup (server bot run-loop,
vitest setup file, or React `useEffect`).

For Phase A the SIMPLEST contract: `decomposeHand` throws if module not
loaded; caller is responsible for preload. Phase B can revisit if needed.

---

## 5. Medium tier integration

### 5.1 Where to hook

`lib/ai/medium.ts` currently uses `rankByCoop` to filter `enumerateLegalMoves`
output, then picks cheapest. Replace the **filtering+selection** step with
the decomposer:

```typescript
// Current (simplified):
const candidates = enumerateLegalMoves(hand, bestPattern, levelRank);
const filtered = rankByCoop(candidates, coopAdvice);
return pickCheapest(filtered);

// Phase A (simplified):
const decomp = decomposeHand(hand, levelRank);
const firstPlay = decomp.plays[0]; // optimal first play per Bobgy
// Validate that firstPlay matches an enumerated legal move; if not, fall
// back to rule-based selection (decomposer may suggest plays that aren't
// valid responses to currentTrick's bestPattern).
const matchingCandidate = candidates.find((c) =>
  cardsMatch(c.pattern.cards, firstPlay.cards),
);
return matchingCandidate ?? pickCheapest(rankByCoop(candidates, coopAdvice));
```

### 5.2 Why preserve the heuristic fallback

The decomposer gives the OPTIMAL standalone hand decomposition — but it
doesn't know what the current trick demands. If the trick's `bestPattern`
is a pair and the decomposer's first play is a single, the decomposer's
suggestion is illegal as a response. The fallback (rule-based heuristic)
handles "respond to trick" cases the decomposer doesn't model. Phase B's
lookahead policy may unify these; for Phase A we just fall back gracefully.

### 5.3 Acceptance for Medium integration

- All existing Medium tier tests pass unchanged (rule-based fallback path
  preserved).
- New tests: decomposer's suggested first play is preferred when it
  matches a legal response to the current trick.
- New tests: when decomposer's suggestion doesn't match, fall back to
  heuristic — no regression.

---

## 6. Test strategy

### 6.1 New test files

| File | Coverage |
|---|---|
| `tests/ai/decomposer/encode.test.ts` | `encodeHand` round-trip: known card sets → known Bobgy strings. Includes 10 → '0', BJ → 'XB', RJ → 'XR', mixed-suit cases. |
| `tests/ai/decomposer/decode.test.ts` | `parseSolutions` for known solution strings. Pipe-separated parsing, empty trick handling. |
| `tests/ai/decomposer/decompose.test.ts` | `decomposeHand` integration: given a known hand + level, expect a non-empty `plays` array with correct total card count. Run against ~5 hand-engineered cases pulled from Bobgy's `test/` data files. |
| `tests/ai/medium.test.ts` (extend) | New cases: decomposer suggestion prevails when legal; fallback when illegal. |

### 6.2 vitest setup

WASM module loads asynchronously. Two approaches:
- **A**: Per-file `beforeAll(() => preloadDecomposer())` in tests touching
  the decomposer. Simple, explicit.
- **B**: Global `tests/setup/wasm.ts` adds preload to all test environments.
  Cleaner but slows down unrelated tests.

Recommend **A** for Phase A. Revisit if many test files need the decomposer.

### 6.3 Node vs jsdom

Decomposer tests can run in default Node env (no DOM needed). Add
`// @vitest-environment node` directive if vitest defaults to jsdom for
the `tests/ai/` subtree.

### 6.4 Regression coverage

Critical: the existing 987 tests MUST still pass. Specifically:
- All Easy bot tests (no decomposer touch).
- All Medium tests with the fallback path.
- All integration tests including `tests/integration/full-game-flow.test.ts`.

The decomposer integration in `medium.ts` is opt-in — if WASM module fails
to load, `decomposeHand` throws and the catch falls back to existing
heuristic. Old tests pass unchanged.

---

## 7. Risks + open questions

| Risk | Mitigation |
|---|---|
| Docker `emscripten/emsdk:latest` image may be massive (multi-GB) | Pin to a specific tagged version (e.g. `3.1.69`); document in `scripts/build-wasm.sh`. |
| First compile produces module that fails to load in vitest's Node env | Try `ENVIRONMENT='node,web'` first; fall back to dual builds (`strategy.node.js` + `strategy.web.js`) if needed. Both can be committed; loader picks based on `typeof window`. |
| Vite's WASM resolution in browser may need explicit `?init` or `?url` | Test in `npm run dev` after first integration; adjust `loader.ts` based on Vite error messages. |
| Bobgy's `calc()` API may segfault on degenerate inputs (empty hand, all wildcards) | Wrap call in `try/catch`; on failure, log + fall back to heuristic. Add edge-case tests. |
| Wildcard decoding (Bobgy's hearts-of-level-rank substitution) may mismatch our `isWildcard` | Cross-check with `tests/ai/decomposer/decompose.test.ts` cases that include wildcards. |
| WASM artifact size in git (~50-100KB) bloats the repo | Acceptable per AX 2026-05-21 decision; revisit if it grows beyond 500KB. |
| `EXPORT_ES6=1` may not be supported on the chosen Emscripten version | Verify with target version's docs; fall back to `MODULARIZE=1` without ES6 + CommonJS interop if needed. |

### Open questions for execution session

1. **Emscripten version**: pin to which tagged release? Recommend latest
   stable (`emscripten/emsdk:latest` for first attempt, swap to specific
   tag once working).
2. **Estimator default**: `MinPlays` or `OverallValue`? Recommend
   `OverallValue` for Medium tier — it preserves high cards which is more
   strategic. `MinPlays` for an eventual "rate my hand" UI surface.
3. **Decomposer caching**: should we memoize per-hand? Bobgy is <10ms per
   call already; probably not worth it for Phase A.

---

## 8. Step-by-step checklist for next session

```
[ ] Reactivate autonomous-grind with Phase A predicate
[ ] Verify Docker still works (`docker ps`)
[ ] Pull emscripten/emsdk image (one-time, ~3-5 min)
[ ] mkdir -p lib/ai/decomposer/{cpp,dist}
[ ] Copy strategy.cpp, cc/common.cpp, cc/common.hpp from /tmp/bobgy-source
    (re-clone if /tmp got cleaned)
[ ] Create lib/ai/decomposer/cpp/LICENSE-bobgy with MIT text + © 2018 Yuan Gong
[ ] Create lib/ai/decomposer/README.md with attribution + rebuild instructions
[ ] Write scripts/build-wasm.sh (from §3.2 above) + chmod +x
[ ] Run scripts/build-wasm.sh — verify dist/strategy.js + dist/strategy.wasm appear
[ ] Write lib/ai/decomposer/encode.ts + tests
[ ] Write lib/ai/decomposer/decode.ts + tests
[ ] Write lib/ai/decomposer/loader.ts
[ ] Write lib/ai/decomposer/index.ts with public API
[ ] Write tests/ai/decomposer/decompose.test.ts — at least 3 hand cases
[ ] npm test — verify decomposer tests pass + 987 baseline still green
[ ] Wire decomposer into lib/ai/medium.ts (with fallback)
[ ] Extend tests/ai/medium.test.ts with decomposer-prevails + fallback cases
[ ] npm test, typecheck, build, security:no-leak — all green
[ ] Visual smoke: npm run dev, verify Medium bot moves still happen in UI
[ ] Commit + push
[ ] Verify GitHub auto-deploy goes Ready
[ ] Clear autonomous-grind
[ ] Sync docs: HANDOFF + CLAUDE + README + this PHASE-A.md status
```

---

## 9. Acceptance criteria (Phase A done = all true)

- `lib/ai/decomposer/dist/strategy.{js,wasm}` exists and is committed.
- `decomposeHand(hand, levelRank)` returns a valid `Decomposition` for
  arbitrary 27-card hands without throwing.
- `decomposeHand` returns the SAME decomposition for the same input
  across multiple calls (deterministic).
- `lib/ai/medium.ts` uses `decomposeHand` as the preferred selection
  strategy, with the existing heuristic as fallback.
- All 987+ pre-existing tests pass.
- New decomposer tests cover encode + decode + decompose end-to-end.
- `npm run build` clean; `npm run typecheck` clean; `npm run security:no-leak` clean.
- GitHub auto-deploy goes Ready (no regression).
- Medium bot still successfully completes a game in `npm run dev` smoke.

---

## 10. Phase B preview (separate session)

After Phase A lands, Phase B brings back Hard tier:

- New `lib/ai/lookahead.ts` — 2-trick lookahead policy on top of decomposer.
- New `lib/ai/handTracker.ts` — opponent hand-count + suit-cardinality
  tracking from move history.
- Extend `lib/ai/dispatch.ts` to route `tier: 'hard'` → lookahead-augmented
  decomposer search.
- UI: re-add Hard chip to `src/screens/CreateRoom.tsx` `AiTier` union +
  `src/screens/Waiting.tsx` `BOT_BADGE` / `BOT_TIER_LABEL`.
- Docs: revert/update the "LLM Hard deleted, Hard returns post-WASM" lines
  in CLAUDE.md + HANDOFF.md to reflect the actual implementation.

Phase B is materially harder than Phase A — lookahead policies for Guandan
are research-grade work (the original AI tier plan deferred this to DanLM).
Plan to scope Phase B separately with its own design phase before execution.
