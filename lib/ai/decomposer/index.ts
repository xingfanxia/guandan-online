// Public API for the Bobgy decomposer.
//
// One call: decomposeHand(hand, levelRank, useOverallValueEstimator?).
// Returns the lowest-cost play sequence according to Bobgy's DFS solver.
// Returns null when the decomposer's first play references cards we
// cannot match back to the input hand (typically wildcard substitution).
// Caller treats null as a fallback signal — see lib/ai/medium.ts.

import type { Card } from '../../game/cards.js';
import type { LevelRank } from '../../game/levels.js';
import { encodeHand, rankToBobgyChar } from './encode.js';
import { decodeSolution, type DecomposerPlay } from './decode.js';
import { getCppModule } from './loader.js';

export type { DecomposerPlay } from './decode.js';

export interface Decomposition {
  /** Minimum cost reported by the solver (interpretation depends on estimator). */
  minCost: number;
  /** Ordered play groups; index 0 is the suggested first play. */
  plays: DecomposerPlay[];
}

let cachedModule: import('./loader.js').CppModule | null = null;
let autoLoadStarted = false;

/**
 * Preload the WASM module. Call once during startup if you want
 * decomposeHand to be hot from the first call. Optional — the first
 * `decomposeHand` call auto-kicks the load (returning null until it
 * resolves, ~100-300ms after server boot), so callers that have a
 * heuristic fallback don't need to await this.
 */
export async function preloadDecomposer(): Promise<void> {
  autoLoadStarted = true;
  cachedModule = await getCppModule();
}

/**
 * Decompose `hand` into the minimum-cost sequence of legal plays via the
 * Bobgy DFS solver. Sync — single-digit ms for a 27-card hand on a 2024
 * laptop.
 *
 * Returns null if:
 *   - the WASM module hasn't been preloaded yet (treat as a startup race —
 *     the caller should already have heuristic fallback in place);
 *   - the solver produces no solutions (degenerate / empty hand), OR
 *   - the first solution can't be matched back to the input hand
 *     (typically because the solver used a wildcard as a different rank).
 *
 * All three cases are unified as "null" so callers have one fallback path.
 */
export function decomposeHand(
  hand: readonly Card[],
  levelRank: LevelRank,
  useOverallValueEstimator: boolean = true,
): Decomposition | null {
  if (!cachedModule) {
    // Kick off the load on first miss so prod callers don't need a manual
    // preload step. Until the promise resolves, decomposeHand returns null
    // and the caller's heuristic fallback runs transparently.
    if (!autoLoadStarted) {
      autoLoadStarted = true;
      preloadDecomposer().catch(() => {
        // WASM load failed (e.g., bundle missing the .wasm file). Keep
        // returning null; bots stay on the heuristic for this process.
      });
    }
    return null;
  }
  if (hand.length === 0) return null;

  const encoded = encodeHand(hand);
  // G-C3 fix: Bobgy uses single-char rank encoding internally — '0' for rank 10
  // (NOT '1' from '10'.charCodeAt(0)). Use the same mapping encode.ts applies
  // to cards. Without this, at level 10 the solver computes mainRank=49 ('1')
  // while encoded cards carry '0' (48); the wildcard substitution path never
  // triggers, the C++ falls through assertions, and the catch below returns null.
  const mainRank = rankToBobgyChar(levelRank).charCodeAt(0);

  let result: import('./loader.js').StrategyResult;
  try {
    result = cachedModule.calc(encoded, mainRank, useOverallValueEstimator);
  } catch {
    return null; // solver bailed on this input
  }

  const size = result.solutions.size();
  if (size === 0) {
    result.solutions.delete?.();
    return null;
  }

  // First solution is the lowest-cost decomposition per the solver.
  const firstSolution = result.solutions.get(0);
  result.solutions.delete?.();

  const plays = decodeSolution(firstSolution, hand);
  if (plays === null) return null;

  return { minCost: result.minHands, plays };
}
