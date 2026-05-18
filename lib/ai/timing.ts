// Bot move-timing — Beta(2, 5)-distributed delays in 800–5500 ms.
//
// SYNC: docs/plan/PLAN.md AI-1 spec — "Bot timing matters for realism — don't
// make bots play instantly even when they can." Beta(2, 5) gives a peak around
// 1200ms with a long tail toward 5s — feels like a player thinking, not a
// computer firing instantly.
//
// Pure-functional. Caller supplies the RNG (Math.random in prod, seedrandom
// in tests).

const MIN_MS = 800;
const MAX_MS = 5500;
const ALPHA = 2;
const BETA = 5;

/**
 * Returns a move delay in [MIN_MS, MAX_MS] sampled from a Beta(α=2, β=5)
 * distribution. Uses the standard inverse-Gamma method via two RNG draws.
 *
 * Beta sampling via Gamma ratio: Gamma(α, 1) / (Gamma(α, 1) + Gamma(β, 1))
 * where Gamma(k, 1) for integer k is the sum of -ln(Uᵢ) for i in 1..k.
 */
export function botMoveDelayMs(rng: () => number): number {
  const u = sampleBeta(rng, ALPHA, BETA);
  return Math.round(MIN_MS + u * (MAX_MS - MIN_MS));
}

function sampleBeta(rng: () => number, alpha: number, beta: number): number {
  const x = sampleGamma(rng, alpha);
  const y = sampleGamma(rng, beta);
  return x / (x + y);
}

/** Gamma(integer-k, 1) via sum of -ln(U) — works for our small integer shape. */
function sampleGamma(rng: () => number, k: number): number {
  let sum = 0;
  for (let i = 0; i < k; i++) {
    // Avoid log(0) — rng() returns [0, 1); clamp away from 0.
    const u = Math.max(rng(), Number.EPSILON);
    sum += -Math.log(u);
  }
  return sum;
}
