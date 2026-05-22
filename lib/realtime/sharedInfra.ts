// Process-wide singleton wrapper around `createRealtimeInfra`.
//
// Why a shared singleton matters:
//   * In LOCAL DEV (memory backend) every route used to wire its own
//     `createMemoryRoomStore()` etc., so a room created in
//     `/api/room/create` was invisible to `/api/room/[code]` — the dev
//     server was silently broken end-to-end.
//   * In PRODUCTION (Upstash backend) state lives in Redis so behavior was
//     correct, but every route still allocated its own `new Redis(...)`,
//     wasting one HTTP keepalive pool per route per warm container.
//
// All Vercel route handlers now call `getSharedInfra()` instead of
// re-implementing the singleton pattern. Tests that need isolated infra
// keep calling `createRealtimeInfra(...)` (or constructing stores
// directly) — this module is for production code paths only.

import { createRealtimeInfra, type RealtimeInfra } from './infra.js';
import type { Redis } from '@upstash/redis';
import {
  createSlidingWindowLimiter,
  createUpstashRateLimiter,
  type RateLimiter,
  type RateLimiterOptions,
} from '../security/rateLimit.js';

let cached: RealtimeInfra | null = null;

export function getSharedInfra(): RealtimeInfra {
  if (!cached) {
    cached = createRealtimeInfra(process.env);
  }
  return cached;
}

/**
 * Reset the cached instance. Used by tests that need to swap envs between
 * cases. Production code should never call this.
 */
export function _resetSharedInfraForTests(): void {
  cached = null;
  rateLimiterCache.clear();
}

// ─── Shared rate-limiter cache (R-I2) ────────────────────────────────────────
//
// Per-route call-site keeps its own RateLimiter instance — one per (key,
// limits) tuple — so we cache by serialized options. Memory limiter is
// per-container (the broken behavior under autoscaling); Upstash limiter
// shares state across all containers via the shared Redis instance.

const rateLimiterCache = new Map<string, RateLimiter>();

export interface SharedRateLimiterOptions extends RateLimiterOptions {
  /** Prefix used to namespace this limiter's Redis keys. Distinguishes
   * `move:*` from `create:*` from `join:*` etc. — without this two routes
   * would share the same counter. */
  prefix: string;
}

/**
 * Return a process-shared rate limiter. Selects Upstash impl when
 * `infra.redis` is non-null, memory impl otherwise. Caches by
 * (prefix, windowMs, max) so repeated calls with the same params return the
 * same instance (memory impl relies on this for correctness).
 *
 * Dev / test relaxation: memory backend (no Upstash credentials) multiplies
 * `max` by `RATE_LIMIT_DEV_MULTIPLIER` (default 50). Local dev + Playwright
 * e2e against the vite api-middleware share a single client identity
 * (localhost), so production-tight quotas like "5 creates per minute" would
 * flood after a handful of tests. Production keeps the original tight quotas
 * because the Upstash branch is taken (multiplier ignored).
 */
export function getSharedRateLimiter(
  opts: SharedRateLimiterOptions
): RateLimiter {
  const cacheKey = `${opts.prefix}:${opts.windowMs}:${opts.max}`;
  const existing = rateLimiterCache.get(cacheKey);
  if (existing) return existing;

  const infra = getSharedInfra();
  let effectiveMax = opts.max;
  if (!infra.redis) {
    const raw = process.env['RATE_LIMIT_DEV_MULTIPLIER'];
    const multiplier =
      raw !== undefined && Number.isFinite(Number(raw)) && Number(raw) > 0
        ? Number(raw)
        : 50;
    effectiveMax = Math.max(opts.max, opts.max * multiplier);
  }

  const limiter = infra.redis
    ? createUpstashRateLimiter(infra.redis as unknown as Redis, {
        windowMs: opts.windowMs,
        max: opts.max,
        prefix: opts.prefix,
      })
    : createSlidingWindowLimiter({
        windowMs: opts.windowMs,
        max: effectiveMax,
      });
  rateLimiterCache.set(cacheKey, limiter);
  return limiter;
}
