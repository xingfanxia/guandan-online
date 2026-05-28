// Process-wide singletons for the SEC-3 / DEPLOY-2 stores.
//
// Why this file exists (and why the singleton logic lives HERE, not in
// sharedInfra.ts):
//   * In LOCAL DEV (memory backend) each Vercel route handler would otherwise
//     wire its own `createMemory*Store()`, so a report written by
//     `/api/report` would be invisible to `/api/admin/reports` — the dev
//     server + e2e would be silently broken end-to-end (the exact bug the
//     audit-fix loop found for roomStore).
//   * In PRODUCTION (Upstash backend) state lives in Redis so correctness
//     doesn't depend on the singleton, but sharing one client still avoids a
//     redundant keepalive pool per route per warm container.
//
// Selection mirrors `getSharedRateLimiter`: `getSharedInfra().redis` non-null
// → Redis impl; null → memory impl. The route wrappers call the getters here
// rather than touching sharedInfra.ts directly (which this milestone must not
// edit).

import { getSharedInfra } from '../realtime/sharedInfra.js';
import type { Redis } from '@upstash/redis';
import type { RedisLike } from '../realtime/redisClient.js';
import {
  createMemoryProfileStore,
  createProfileStore,
  type ProfileStore,
} from './profileStore.js';
import {
  createMemoryReportStore,
  createReportStore,
  type ReportStore,
} from '../security/reports.js';
import {
  createMemoryLatencyStore,
  createLatencyStore,
  type LatencyStore,
} from '../telemetry/aggregate.js';
import {
  createMemorySeenStore,
  createSeenStore,
  type SeenStore,
} from './seenStore.js';

let profileStore: ProfileStore | null = null;
let reportStore: ReportStore | null = null;
let latencyStore: LatencyStore | null = null;
let seenStore: SeenStore | null = null;

/** `infra.redis` is typed as `Redis | null`; RedisLike is the narrower
 * structural contract our stores actually consume. The cast is the same one
 * `getSharedRateLimiter` makes. */
function sharedRedis(): RedisLike | null {
  return (getSharedInfra().redis as unknown as RedisLike | null) ?? null;
}

export function getProfileStore(): ProfileStore {
  if (!profileStore) {
    const redis = sharedRedis();
    profileStore = redis ? createProfileStore(redis) : createMemoryProfileStore();
  }
  return profileStore;
}

export function getReportStore(): ReportStore {
  if (!reportStore) {
    const redis = sharedRedis();
    reportStore = redis ? createReportStore(redis) : createMemoryReportStore();
  }
  return reportStore;
}

export function getLatencyStore(): LatencyStore {
  if (!latencyStore) {
    const redis = sharedRedis();
    latencyStore = redis ? createLatencyStore(redis) : createMemoryLatencyStore();
  }
  return latencyStore;
}

/** AI-4 per-player liveness store (SSE heartbeat → dc-check cron). */
export function getSeenStore(): SeenStore {
  if (!seenStore) {
    const redis = sharedRedis();
    seenStore = redis ? createSeenStore(redis) : createMemorySeenStore();
  }
  return seenStore;
}

/**
 * Reset the cached singletons. Used by tests that swap envs / Redis backends
 * between cases. Production code must never call this. Note: `Redis` is
 * imported only to keep the type-only reference alive for tooling; the runtime
 * selection uses the RedisLike structural type.
 */
export function _resetSharedStoresForTests(): void {
  profileStore = null;
  reportStore = null;
  latencyStore = null;
  seenStore = null;
}

// Touch the imported Redis type so the import isn't elided in isolatedModules
// builds — it documents that infra.redis is an @upstash/redis instance.
export type _SharedStoresRedis = Redis;
