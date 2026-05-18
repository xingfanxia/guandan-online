// Realtime infrastructure factory — the single entry point API routes use to
// obtain a wired bus + log + idempotency cache. Selects memory vs Upstash by
// inspecting the env object passed in (typically process.env).
//
// Why a factory: API routes shouldn't import @upstash/redis directly. That
// keeps unit tests fast (no network shim required) and lets local dev mode
// skip Redis entirely. The single seam here also makes future infra swaps
// (e.g., Redis Cluster, alternative pubsub) a one-file change.

import { Redis } from '@upstash/redis';
import type { EventBus } from './eventBus';
import { createMemoryEventBus, createUpstashEventBus } from './eventBus';
import type { EventLog } from './eventLog';
import { createMemoryEventLog, createUpstashEventLog } from './eventLog';
import type { IdempotencyCache } from './idempotency';
import {
  createMemoryIdempotencyCache,
  createUpstashIdempotencyCache,
} from './idempotency';
import type { RedisLike } from './redisClient';

export interface RealtimeInfra {
  bus: EventBus;
  log: EventLog;
  idempotency: IdempotencyCache;
  /** Which backing implementation was selected — for logging / health checks. */
  backend: 'memory' | 'upstash';
}

/**
 * Subset of env we care about. Pass `process.env` from a route handler; tests
 * pass a plain object so they don't have to mutate global state.
 */
export interface RealtimeEnv {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
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
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const redis = new Redis({ url, token }) as unknown as RedisLike;
    return wireUpstash(redis);
  }
  return {
    bus: createMemoryEventBus(),
    log: createMemoryEventLog(),
    idempotency: createMemoryIdempotencyCache(),
    backend: 'memory',
  };
}

function wireUpstash(redis: RedisLike): RealtimeInfra {
  return {
    bus: createUpstashEventBus(redis),
    log: createUpstashEventLog(redis),
    idempotency: createUpstashIdempotencyCache(redis),
    backend: 'upstash',
  };
}
