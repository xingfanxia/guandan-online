// Room persistence — thin Redis wrapper over the existing RedisLike contract.
//
// Routes load room state, mutate it through the pure functions in
// lib/room/lifecycle.ts, then save it back through this store. Atomic
// create (SET NX) lets the create-room route retry on the rare code
// collision without a separate "code claim" key.

import type { RoomState } from '../room/lifecycle';
import type { RedisLike } from '../realtime/redisClient';

// ─── Memory implementation ────────────────────────────────────────────────────
//
// Map-backed; rooms vanish on process restart. Used by dev mode + unit tests
// for route handlers. The realtime infra factory wires this when no Upstash
// credentials are present.

interface MemoryEntry {
  value: RoomState;
  expiresAt: number | null;
}

export function createMemoryRoomStore(
  clock: () => number = Date.now
): RoomStore {
  const store = new Map<string, MemoryEntry>();

  function alive(entry: MemoryEntry | undefined): entry is MemoryEntry {
    if (!entry) return false;
    if (entry.expiresAt === null) return true;
    if (entry.expiresAt <= clock()) {
      return false;
    }
    return true;
  }

  return {
    async get(code) {
      const entry = store.get(code);
      if (!alive(entry)) {
        store.delete(code);
        return null;
      }
      return entry.value;
    },
    async put(state, ttlSeconds) {
      store.set(state.code, {
        value: state,
        expiresAt: clock() + ttlSeconds * 1000,
      });
    },
    async create(state, ttlSeconds) {
      if (alive(store.get(state.code))) return false;
      store.set(state.code, {
        value: state,
        expiresAt: clock() + ttlSeconds * 1000,
      });
      return true;
    },
    async delete(code) {
      store.delete(code);
    },
  };
}

export interface RoomStore {
  /** Returns the room state for `code`, or null if missing or expired. */
  get(code: string): Promise<RoomState | null>;
  /** Overwrites the room state with a fresh TTL. */
  put(state: RoomState, ttlSeconds: number): Promise<void>;
  /**
   * Atomic create. Returns true if the room was created, false if a room
   * with this code already exists. Use false → retry with a fresh code.
   */
  create(state: RoomState, ttlSeconds: number): Promise<boolean>;
  /** Removes the room. Idempotent. */
  delete(code: string): Promise<void>;
}

export interface RoomStoreOptions {
  /** Key namespace prefix. Defaults to 'room:'. */
  keyPrefix?: string;
}

export function createRoomStore(
  redis: RedisLike,
  options: RoomStoreOptions = {}
): RoomStore {
  const prefix = options.keyPrefix ?? 'room:';
  const k = (code: string) => `${prefix}${code}`;

  return {
    async get(code) {
      const data = await redis.get<RoomState>(k(code));
      return data ?? null;
    },

    async put(state, ttlSeconds) {
      await redis.set(k(state.code), JSON.stringify(state), { ex: ttlSeconds });
    },

    async create(state, ttlSeconds) {
      const result = await redis.set(k(state.code), JSON.stringify(state), {
        nx: true,
        ex: ttlSeconds,
      });
      return result === 'OK';
    },

    async delete(code) {
      await redis.del(k(code));
    },
  };
}
