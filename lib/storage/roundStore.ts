// Per-room GameRound persistence with monotonic version tracking.
//
// The room metadata (lobby state, members, host token) lives in roomStore.
// Once a room enters 'in_game', this store holds the active round plus the
// version counter that drives optimistic-concurrency checks in handleMove.
//
// SYNC: docs/research/realtime-sync-deep-dive.md §7.2 "version" — every
// successful move bumps the version; clients pass `fromVersion` so retries
// across crashes are safe.

import type { GameRound } from '../game/round.js';
import type { RedisLike } from '../realtime/redisClient.js';

/**
 * What we actually persist. Wrapping the round + version in one cell keeps
 * the read+write atomic at the JSON level — no chance of seeing a round
 * without a version or vice-versa.
 */
export interface RoundEnvelope {
  round: GameRound;
  version: number;
  /** Wall-clock at last mutation; useful for stale-state TTL extension. */
  updatedAt: number;
}

export interface RoundStore {
  get(code: string): Promise<RoundEnvelope | null>;
  put(code: string, envelope: RoundEnvelope, ttlSeconds: number): Promise<void>;
  delete(code: string): Promise<void>;
}

export interface RoundStoreOptions {
  keyPrefix?: string;
}

// ─── Upstash impl ─────────────────────────────────────────────────────────────

export function createRoundStore(
  redis: RedisLike,
  options: RoundStoreOptions = {}
): RoundStore {
  const prefix = options.keyPrefix ?? 'round:';
  const k = (code: string) => `${prefix}${code}`;

  return {
    async get(code) {
      const data = await redis.get<RoundEnvelope>(k(code));
      return data ?? null;
    },
    async put(code, envelope, ttlSeconds) {
      await redis.set(k(code), JSON.stringify(envelope), { ex: ttlSeconds });
    },
    async delete(code) {
      await redis.del(k(code));
    },
  };
}

// ─── Memory impl ──────────────────────────────────────────────────────────────

interface MemoryEntry {
  envelope: RoundEnvelope;
  expiresAt: number | null;
}

export function createMemoryRoundStore(
  clock: () => number = Date.now
): RoundStore {
  const store = new Map<string, MemoryEntry>();

  function alive(entry: MemoryEntry | undefined): entry is MemoryEntry {
    if (!entry) return false;
    if (entry.expiresAt === null) return true;
    return entry.expiresAt > clock();
  }

  return {
    async get(code) {
      const entry = store.get(code);
      if (!alive(entry)) {
        store.delete(code);
        return null;
      }
      return entry.envelope;
    },
    async put(code, envelope, ttlSeconds) {
      store.set(code, {
        envelope,
        expiresAt: clock() + ttlSeconds * 1000,
      });
    },
    async delete(code) {
      store.delete(code);
    },
  };
}
