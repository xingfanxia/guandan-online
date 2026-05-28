// Account-creation throttle — caps how many new @handles a single IP can
// register inside a rolling 24h window. (SEC-2)
//
// Distinct from lib/security/rateLimit.ts: that's a short-window request
// throttle (5/min on /create); this is a long-window ACCOUNT-creation cap
// (5 new handles / 24h / IP). A spammer who paces requests under the per-min
// rate limit can still mint hundreds of throwaway handles a day; this counter
// is the gate against that.
//
// Two implementations target the IpThrottle contract, mirroring roomStore.ts:
//   - createMemoryIpThrottle(clock?)  — Map-backed; dev / tests / per-container
//   - createIpThrottle(redis)         — Upstash-backed; one shared counter
//                                       across all warm containers
//
// The Redis impl uses INCR + EXPIRE on `ipacct:<ipHash>` — the same TTL-on-
// first-touch pattern roomStore uses for its keys. EXPIRE is set on the first
// increment so the 24h window starts at the first registration and the key
// self-cleans afterward.

import type { RedisLike } from '../realtime/redisClient.js';

export interface IpThrottleResult {
  /** True when this registration is within quota (and was counted). */
  allowed: boolean;
  /** Post-increment count of registrations from this IP in the window. */
  count: number;
}

export interface IpThrottle {
  /**
   * Record one account-creation attempt from `ipHash`. Increments the windowed
   * counter and returns whether the caller is still within quota.
   *
   * IMPORTANT: the count is incremented even when the result is `allowed:
   * false` — a denied 6th attempt still bumps the counter, so the window only
   * resets on TTL expiry, never by the caller backing off. This matches the
   * acceptance criterion ("6th account → 429; window expiry resets").
   */
  tryRegister(ipHash: string, now: number): IpThrottleResult | Promise<IpThrottleResult>;
}

export interface IpThrottleOptions {
  /** Max registrations per IP per window. Defaults to 5. */
  max?: number;
  /** Window length in seconds. Defaults to 24h. */
  windowSeconds?: number;
  /** Key namespace prefix for the Redis impl. Defaults to 'ipacct:'. */
  keyPrefix?: string;
}

/** Default registrations allowed per IP per window. */
export const DEFAULT_MAX_ACCOUNTS = 5;
/** Default window — 24 hours. */
export const DEFAULT_WINDOW_SECONDS = 24 * 60 * 60;

// ─── Memory implementation ────────────────────────────────────────────────────
//
// Map-backed; counters vanish on process restart. Each entry holds the count
// plus the wall-clock ms when the 24h window expires. A lookup past expiry
// resets the entry — that's the "window expiry resets" behavior.

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

export function createMemoryIpThrottle(
  // Accepted for call-signature parity with the other store factories, but the
  // window math is driven entirely by the explicit `now` passed to
  // tryRegister (so tests control time precisely), making the injected clock
  // redundant here.
  _clock: () => number = Date.now,
  options: IpThrottleOptions = {}
): IpThrottle {
  const max = options.max ?? DEFAULT_MAX_ACCOUNTS;
  const windowMs = (options.windowSeconds ?? DEFAULT_WINDOW_SECONDS) * 1000;
  const counts = new Map<string, MemoryEntry>();

  return {
    tryRegister(ipHash, now): IpThrottleResult {
      // `now` is the authoritative clock for window math so tests can drive it;
      // the injected `clock` is only a default for callers that don't pass now.
      const at = now;
      const existing = counts.get(ipHash);
      if (!existing || existing.expiresAt <= at) {
        // Fresh window (no entry, or the previous window has expired).
        counts.set(ipHash, { count: 1, expiresAt: at + windowMs });
        return { allowed: true, count: 1 };
      }
      const count = existing.count + 1;
      counts.set(ipHash, { count, expiresAt: existing.expiresAt });
      return { allowed: count <= max, count };
    },
  };
}

// ─── Upstash Redis implementation ──────────────────────────────────────────────
//
// INCR returns the post-increment count. We set EXPIRE only on the first
// increment (count === 1) so the window anchors to the first registration and
// the key self-expires after `windowSeconds`. Subsequent increments inside the
// window leave the TTL untouched (matching Redis INCR semantics — INCR does
// not refresh expiry).

export function createIpThrottle(
  redis: RedisLike,
  options: IpThrottleOptions = {}
): IpThrottle {
  const max = options.max ?? DEFAULT_MAX_ACCOUNTS;
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const prefix = options.keyPrefix ?? 'ipacct:';
  const k = (ipHash: string) => `${prefix}${ipHash}`;

  return {
    async tryRegister(ipHash): Promise<IpThrottleResult> {
      const count = await redis.incr(k(ipHash));
      if (count === 1) {
        // First registration in this window — anchor the TTL. If EXPIRE were
        // skipped the key would persist forever and a single IP could be
        // permanently locked out after 5 lifetime creates.
        await redis.expire(k(ipHash), windowSeconds);
      }
      return { allowed: count <= max, count };
    },
  };
}
