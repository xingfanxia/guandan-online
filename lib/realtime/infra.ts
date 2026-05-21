// Realtime infrastructure factory — the single entry point API routes use to
// obtain a wired bus + log + idempotency cache. Selects memory vs Upstash by
// inspecting the env object passed in (typically process.env).
//
// Why a factory: API routes shouldn't import @upstash/redis directly. That
// keeps unit tests fast (no network shim required) and lets local dev mode
// skip Redis entirely. The single seam here also makes future infra swaps
// (e.g., Redis Cluster, alternative pubsub) a one-file change.

import { Redis } from '@upstash/redis';
import type { EventBus } from './eventBus.js';
import { createMemoryEventBus, createUpstashEventBus } from './eventBus.js';
import type { EventLog } from './eventLog.js';
import { createMemoryEventLog, createUpstashEventLog } from './eventLog.js';
import type { IdempotencyCache } from './idempotency.js';
import {
  createMemoryIdempotencyCache,
  createUpstashIdempotencyCache,
} from './idempotency.js';
import type { RedisLike } from './redisClient.js';
import type { RoomStore } from '../storage/roomStore.js';
import { createMemoryRoomStore, createRoomStore } from '../storage/roomStore.js';
import type { RoundStore } from '../storage/roundStore.js';
import { createMemoryRoundStore, createRoundStore } from '../storage/roundStore.js';
import type { SessionStore } from '../storage/sessionStore.js';
import {
  createMemorySessionStore,
  createSessionStore,
} from '../storage/sessionStore.js';

export interface RealtimeInfra {
  bus: EventBus;
  log: EventLog;
  idempotency: IdempotencyCache;
  roomStore: RoomStore;
  roundStore: RoundStore;
  sessionStore: SessionStore;
  /** Which backing implementation was selected — for logging / health checks. */
  backend: 'memory' | 'upstash';
  /**
   * Underlying Redis when `backend === 'upstash'`, otherwise null. Exposed so
   * route handlers can construct adjacent Upstash-backed clients (presence,
   * cleanup, future telemetry stores) without having to re-read env vars.
   *
   * NOTE: per-app independent Upstash instance — guandan-online and sibling
   * scorer (guandan-calc) each have their own Marketplace-provisioned Redis
   * after the 2026-05-19 cross-app teardown decision. No shared key space.
   */
  redis: RedisLike | null;
}

/**
 * Subset of env we care about. Pass `process.env` from a route handler; tests
 * pass a plain object so they don't have to mutate global state.
 *
 * Both naming pairs are supported:
 *   - `UPSTASH_REDIS_REST_{URL,TOKEN}` — the names @upstash/redis docs use
 *   - `KV_REST_API_{URL,TOKEN}` — what Vercel's Upstash Marketplace integration
 *     auto-provisions (and what the `vercel env pull` output contains)
 * When both pairs are present, the UPSTASH-prefixed pair wins.
 */
export interface RealtimeEnv {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  KV_REST_API_URL?: string;
  KV_REST_API_TOKEN?: string;
}

export interface RealtimeInfraOptions {
  /**
   * Inject a custom RedisLike — primarily for tests that exercise the Upstash
   * branch without a real Upstash account. When provided, the env vars are
   * not consulted and the Upstash factories are used unconditionally.
   */
  redis?: RedisLike;
}

export function createRealtimeInfra(
  env: RealtimeEnv,
  options: RealtimeInfraOptions = {}
): RealtimeInfra {
  if (options.redis) {
    return wireUpstash(options.redis);
  }
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  if (url && token) {
    const redis = new Redis({ url, token }) as unknown as RedisLike;
    return wireUpstash(redis);
  }
  return {
    bus: createMemoryEventBus(),
    log: createMemoryEventLog(),
    idempotency: createMemoryIdempotencyCache(),
    roomStore: createMemoryRoomStore(),
    roundStore: createMemoryRoundStore(),
    sessionStore: createMemorySessionStore(),
    backend: 'memory',
    redis: null,
  };
}

function wireUpstash(redis: RedisLike): RealtimeInfra {
  return {
    bus: createUpstashEventBus(redis),
    log: createUpstashEventLog(redis),
    idempotency: createUpstashIdempotencyCache(redis),
    roomStore: createRoomStore(redis),
    roundStore: createRoundStore(redis),
    sessionStore: createSessionStore(redis),
    backend: 'upstash',
    redis,
  };
}
