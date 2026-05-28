// Per-player liveness store (AI-4). The SSE handler bumps a player's "seen"
// timestamp on connect and on every heartbeat tick (~20s) — a server-confirmed
// liveness signal, since a heartbeat write only succeeds while the connection
// is open. The dc-check cron reads these timestamps to find humans who have
// gone silent past the disconnect threshold.
//
// Why a SEPARATE store (not RoomState.lastSeenAt on the room hash): bumping the
// room hash every heartbeat would be a read-modify-write that races concurrent
// lifecycle mutations — the exact R-I1 failure class fixed for move activity.
// Per-player keys are written only by that player's own connection, so there is
// no cross-writer race. Mirrors the memory + RedisLike dual-impl of roomStore.

import type { RedisLike } from '../realtime/redisClient.js';

export interface SeenStore {
  /** Record that `playerId` was alive at `timestamp` (TTL-bounded). */
  markSeen(
    code: string,
    playerId: string,
    timestamp: number,
    ttlSeconds: number
  ): Promise<void>;
  /** Last-seen timestamp for a player, or null if unset / expired. */
  getSeen(code: string, playerId: string): Promise<number | null>;
}

export function createMemorySeenStore(
  clock: () => number = Date.now
): SeenStore {
  const store = new Map<string, { value: number; expiresAt: number }>();
  const key = (code: string, playerId: string): string => `${code}:${playerId}`;

  return {
    async markSeen(code, playerId, timestamp, ttlSeconds) {
      store.set(key(code, playerId), {
        value: timestamp,
        expiresAt: clock() + ttlSeconds * 1000,
      });
    },
    async getSeen(code, playerId) {
      const entry = store.get(key(code, playerId));
      if (!entry) return null;
      if (entry.expiresAt <= clock()) {
        store.delete(key(code, playerId));
        return null;
      }
      return entry.value;
    },
  };
}

export interface SeenStoreOptions {
  /** Key namespace prefix. Defaults to 'seen:'. */
  keyPrefix?: string;
}

export function createSeenStore(
  redis: RedisLike,
  options: SeenStoreOptions = {}
): SeenStore {
  const prefix = options.keyPrefix ?? 'seen:';
  const k = (code: string, playerId: string): string =>
    `${prefix}${code}:${playerId}`;

  return {
    async markSeen(code, playerId, timestamp, ttlSeconds) {
      await redis.set(k(code, playerId), JSON.stringify(timestamp), {
        ex: ttlSeconds,
      });
    },
    async getSeen(code, playerId) {
      const v = await redis.get<number>(k(code, playerId));
      return typeof v === 'number' ? v : null;
    },
  };
}
