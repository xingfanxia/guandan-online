// Room persistence — thin Redis wrapper over the existing RedisLike contract.
//
// Routes load room state, mutate it through the pure functions in
// lib/room/lifecycle.ts, then save it back through this store. Atomic
// create (SET NX) lets the create-room route retry on the rare code
// collision without a separate "code claim" key.
//
// Active-code index (added for CRON-1): every successful create() also
// SADD's the code to `<keyPrefix>active` (a Redis set), and delete() SREM's
// it. The cron cleanup-rooms endpoint scans this index to find stale rooms
// that the TTL hasn't caught yet (e.g., abandoned mid-game). Listing room
// codes via SCAN on the data keys would work, but a dedicated set is
// O(1) per mutation and far cheaper to enumerate.

import type { RoomState } from '../room/lifecycle.js';
import type { RedisLike } from '../realtime/redisClient.js';

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
  const activeCodes = new Set<string>();
  // Activity side-store: keyed by code, holds the last-active timestamp
  // independently of the room hash. See touchActivity for why this is
  // separate (R-I1 race fix).
  const activity = new Map<string, { value: number; expiresAt: number }>();

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
        activeCodes.delete(code); // index drifts if TTL expired silently
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
      activeCodes.add(state.code);
      return true;
    },
    async delete(code) {
      store.delete(code);
      activeCodes.delete(code);
      activity.delete(code);
    },
    async listCodes() {
      return [...activeCodes];
    },
    async touchActivity(code, timestamp, ttlSeconds) {
      activity.set(code, {
        value: timestamp,
        expiresAt: clock() + ttlSeconds * 1000,
      });
    },
    async getActivity(code) {
      const entry = activity.get(code);
      if (!entry) return null;
      if (entry.expiresAt <= clock()) {
        activity.delete(code);
        return null;
      }
      return entry.value;
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
   * Successful creates also add the code to the active-codes index.
   */
  create(state: RoomState, ttlSeconds: number): Promise<boolean>;
  /**
   * Removes the room. Idempotent. Also removes the code from the
   * active-codes index.
   */
  delete(code: string): Promise<void>;
  /**
   * Enumerate every code currently in the active-codes index. Used by the
   * cron cleanup pass to find stale rooms the TTL hasn't yet pruned. May
   * include codes whose underlying room key has already TTL'd out — callers
   * MUST handle a null get() by calling delete() to reconcile the index.
   */
  listCodes(): Promise<string[]>;
  /**
   * R-I1 race fix: bump the room's last-active timestamp on a SEPARATE key,
   * never touching the room hash. The move handler calls this on every move
   * so the cron sweep doesn't GC a long-but-quiet round. Writing to a side
   * key (instead of read-modify-write on the room hash) means a concurrent
   * /leave's mutation can never be clobbered by an activity bump. The cron
   * staleness check reads max(room.lastActiveAt, getActivity(code)).
   */
  touchActivity(
    code: string,
    timestamp: number,
    ttlSeconds: number
  ): Promise<void>;
  /** Read the side-key activity timestamp, or null if unset/expired. */
  getActivity(code: string): Promise<number | null>;
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
  const indexKey = `${prefix}active`;
  const activeAtKey = (code: string) => `${prefix}active-at:${code}`;

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
      if (result === 'OK') {
        await redis.sadd(indexKey, state.code);
        return true;
      }
      return false;
    },

    async delete(code) {
      await redis.del(k(code));
      await redis.srem(indexKey, code);
      await redis.del(activeAtKey(code));
    },

    async listCodes() {
      return redis.smembers(indexKey);
    },

    async touchActivity(code, timestamp, ttlSeconds) {
      await redis.set(activeAtKey(code), JSON.stringify(timestamp), {
        ex: ttlSeconds,
      });
    },

    async getActivity(code) {
      const v = await redis.get<number>(activeAtKey(code));
      return typeof v === 'number' ? v : null;
    },
  };
}
