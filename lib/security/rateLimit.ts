// Rate limiter — sliding-window pattern for anti-cheat baseline.
//
// SYNC: docs/plan/PLAN.md SEC-1 spec (anti-cheat baseline). Used at API entry
// to throttle per-IP and per-player request rates.
//
// Two implementations target the RateLimiter contract:
//   - createSlidingWindowLimiter(opts)        — in-process; for dev / tests
//   - createUpstashRateLimiter(redis, opts)   — backed by @upstash/ratelimit
//
// The in-memory impl is **per-container**: under Vercel autoscaling each warm
// instance maintains its own counter, so N parallel containers × max becomes
// the effective system-wide quota. The Upstash impl shares state across all
// containers via Redis — single shared counter, one true quota.
//
// Production routes pick via getSharedRateLimiter (or similar plumbing) based
// on whether `infra.redis` is non-null. Tests stay on the memory impl.

import { Ratelimit } from '@upstash/ratelimit';
import type { Redis } from '@upstash/redis';

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the next slot opens. Set when allowed === false. */
  retryAfterMs?: number;
}

export interface RateLimiter {
  check(key: string, now: number): RateLimitResult | Promise<RateLimitResult>;
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

export function createSlidingWindowLimiter(opts: RateLimiterOptions): RateLimiter {
  if (opts.max < 1) {
    throw new Error(`createSlidingWindowLimiter: max must be ≥1, got ${opts.max}`);
  }
  if (opts.windowMs <= 0) {
    throw new Error(`createSlidingWindowLimiter: windowMs must be >0, got ${opts.windowMs}`);
  }

  const buckets = new Map<string, number[]>();

  return {
    check(key, now) {
      let timestamps = buckets.get(key);
      if (!timestamps) {
        timestamps = [];
        buckets.set(key, timestamps);
      }

      // Drop expired entries — anything older than (now - windowMs).
      const cutoff = now - opts.windowMs;
      while (timestamps.length > 0 && timestamps[0]! <= cutoff) {
        timestamps.shift();
      }

      if (timestamps.length < opts.max) {
        timestamps.push(now);
        return { allowed: true };
      }

      // Denied. Compute retry time based on when the oldest in-window entry
      // expires.
      const oldest = timestamps[0]!;
      const retryAfterMs = oldest + opts.windowMs - now;
      return { allowed: false, retryAfterMs };
    },
  };
}

// ─── Upstash Redis implementation ─────────────────────────────────────────────
//
// Wraps @upstash/ratelimit's sliding-window algorithm to satisfy the RateLimiter
// contract. The window is expressed as a `Duration` string (e.g., `"10 s"`,
// `"1 m"`); we convert from `windowMs` for parity with the in-memory impl.
//
// Why a structural seam: the @upstash/ratelimit Ratelimit class accepts an
// @upstash/redis Redis instance (or a structurally-compatible object). Tests
// can substitute the in-memory fake from tests/realtime/_fakeRedis.ts.

export interface UpstashRateLimiterOptions extends RateLimiterOptions {
  /** Key namespace prefix for the underlying Redis keys. Defaults to 'rl:'. */
  prefix?: string;
  /** Optional analytics opt-in. Off by default (saves Redis ops). */
  analytics?: boolean;
}

/** Minimal contract for a Ratelimit-compatible Redis client. The Upstash
 * library accepts any structurally compatible client. Exposing the type
 * loosely keeps tests free of full Upstash client mocking. */
type RatelimitRedis = ConstructorParameters<typeof Ratelimit>[0]['redis'];

export function createUpstashRateLimiter(
  redis: Redis | RatelimitRedis,
  opts: UpstashRateLimiterOptions
): RateLimiter {
  if (opts.max < 1) {
    throw new Error(`createUpstashRateLimiter: max must be ≥1, got ${opts.max}`);
  }
  if (opts.windowMs <= 0) {
    throw new Error(
      `createUpstashRateLimiter: windowMs must be >0, got ${opts.windowMs}`
    );
  }

  const window = msToDuration(opts.windowMs);
  const ratelimit = new Ratelimit({
    redis: redis as RatelimitRedis,
    limiter: Ratelimit.slidingWindow(opts.max, window),
    prefix: opts.prefix ?? 'rl:',
    analytics: opts.analytics ?? false,
  });

  return {
    async check(key, now) {
      // RatelimitResponse is declared but not exported by @upstash/ratelimit;
      // we rely on type inference here.
      const result = await ratelimit.limit(key);
      if (result.success) {
        return { allowed: true };
      }
      // RatelimitResponse.reset is a UNIX-ms timestamp of when the window
      // unlocks. Convert to a retry-after delta relative to the caller's now.
      const retryAfterMs = Math.max(0, result.reset - now);
      return { allowed: false, retryAfterMs };
    },
  };
}

/**
 * Convert a millisecond window to @upstash/ratelimit's Duration string format.
 * The library accepts shapes like "10 s" / "30 m" / "1 h" / "1 d"; pick the
 * coarsest unit that exactly divides the input (rounded to the nearest
 * second), so 10_000 → "10 s", 60_000 → "1 m", etc.
 */
function msToDuration(windowMs: number): `${number} ${'s' | 'm' | 'h' | 'd'}` {
  const seconds = Math.max(1, Math.round(windowMs / 1000));
  if (seconds % 86_400 === 0) return `${seconds / 86_400} d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} m`;
  return `${seconds} s`;
}
