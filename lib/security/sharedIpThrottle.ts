// Process-wide singleton for the SEC-2 account-creation throttle.
//
// Mirrors lib/storage/sharedStores.ts exactly: selects the Upstash-backed
// impl when getSharedInfra().redis is non-null, else the memory impl. The
// route wrapper (api/auth/createHandle.ts) calls getIpThrottle() rather than
// touching sharedInfra.ts directly (which this milestone must not edit).
//
// Why a singleton matters in LOCAL DEV (memory backend): each Vercel route
// handler module would otherwise wire its own createMemoryIpThrottle(), so the
// counter would reset per route. There's only one route consuming the throttle
// today (createHandle), but keeping the selection here matches the established
// shared-store pattern and means a second consumer can't accidentally fork the
// counter. In PRODUCTION the count lives in Redis so correctness doesn't depend
// on the singleton — sharing one client just avoids a redundant pool.

import { getSharedInfra } from '../realtime/sharedInfra.js';
import type { Redis } from '@upstash/redis';
import type { RedisLike } from '../realtime/redisClient.js';
import {
  createMemoryIpThrottle,
  createIpThrottle,
  type IpThrottle,
} from './ipThrottle.js';

let ipThrottle: IpThrottle | null = null;

/** `infra.redis` is typed as `Redis | null`; RedisLike is the narrower
 * structural contract the throttle consumes. Same cast as getSharedRateLimiter. */
function sharedRedis(): RedisLike | null {
  return (getSharedInfra().redis as unknown as RedisLike | null) ?? null;
}

export function getIpThrottle(): IpThrottle {
  if (!ipThrottle) {
    const redis = sharedRedis();
    ipThrottle = redis ? createIpThrottle(redis) : createMemoryIpThrottle();
  }
  return ipThrottle;
}

/**
 * Reset the cached singleton. Used by tests that swap Redis backends between
 * cases. Production code must never call this.
 */
export function _resetSharedIpThrottleForTests(): void {
  ipThrottle = null;
}

// Touch the imported Redis type so it isn't elided under isolatedModules — it
// documents that infra.redis is an @upstash/redis instance.
export type _SharedIpThrottleRedis = Redis;
