// Rate limiter — sliding-window pattern for anti-cheat baseline.
//
// SYNC: docs/plan/PLAN.md SEC-1 spec (anti-cheat baseline). Used at API entry
// to throttle per-IP and per-player request rates. In-memory impl here is for
// dev / tests; production uses @upstash/ratelimit (sliding-window-redis) which
// shares semantics — same windowMs / max contract.
//
// Pure-functional API. State is encapsulated in the closure returned by
// createSlidingWindowLimiter — caller treats it as opaque.

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the next slot opens. Set when allowed === false. */
  retryAfterMs?: number;
}

export interface RateLimiter {
  check(key: string, now: number): RateLimitResult;
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
