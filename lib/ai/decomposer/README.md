# Bobgy Decomposer (vendored)

Hand-decomposition DFS solver for Guandan, ported from Bobgy's
[poker-guandan-strategy](https://github.com/Bobgy/poker-guandan-strategy).

The C++ source under `cpp/` is **verbatim from upstream** except for two
small patches, each marked with `// PATCH:` so they're easy to diff:

1. `strategy.cpp` — include path flattened from `cc/common.hpp` →
   `common.hpp` (we don't mirror the `cc/` subdirectory).
2. `common.cpp` — added `#include <cassert>` (newer emsdk libc++ headers
   no longer pull it in transitively; upstream still builds against an
   older toolchain that did).

All other code is byte-for-byte identical to upstream HEAD as of
2026-05-21. When re-vendoring from a future upstream commit, re-apply
both patches.

## License

MIT, © 2018 Yuan Gong. See `cpp/LICENSE-bobgy` for the full notice.
This vendored copy carries the original license verbatim.

## How to rebuild the WASM artifact

The compiled `dist/strategy.{js,wasm}` artifacts are committed and need
not be rebuilt on every checkout. Rebuild **only** when:

- `cpp/strategy.cpp` or `cpp/common.{cpp,hpp}` change (e.g., an upstream
  upgrade), OR
- The build flags in `scripts/build-wasm.sh` change.

Requirements: Docker.

```bash
./scripts/build-wasm.sh
```

This pulls `emscripten/emsdk:latest` if needed and runs `em++` inside the
container. Output: `dist/strategy.js` (ES6 module factory, ~14KB) +
`dist/strategy.wasm` (compiled solver, ~50-100KB). Both are committed.

## Public API

The TypeScript wrapper exposes one function:

```typescript
import { decomposeHand, preloadDecomposer } from '@lib/ai/decomposer';

// Call once at startup (server bot run-loop, vitest setup).
await preloadDecomposer();

// Decompose a hand into the minimum-cost sequence of plays.
const decomp = decomposeHand(hand, levelRank);
// decomp.plays[0] is the optimal FIRST play; remaining plays follow.
```

See `index.ts` for full type definitions.

## Phase A scope

This package ships the decomposer as a **hand-shape estimator** for the
Medium AI tier — it's called once per turn, the first suggested play is
preferred if it matches a legal response to the current trick, and the
existing rule-based heuristic (`lib/ai/coop.ts:rankByCoop`) is the
fallback. See `docs/plan/bobgy/PHASE-A.md` for the design contract.

Phase B (separate session) will add lookahead policy on top of the
decomposer and revive the Hard tier.
