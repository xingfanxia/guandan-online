// Per-room GameSession persistence — session-level state that survives
// across rounds (team levels, A-fail counters, round owner, finished-round
// count, winner team).
//
// Distinct from roundStore (which holds the currently-active GameRound).
// startGame creates a fresh session; the move handler updates it via
// applyRoundResult when a round finishes; cleanup deletes it alongside the
// round when the game ends.
//
// SYNC: lib/game/session.ts § GameSession type. The schema here is a 1:1
// JSON projection — no envelope wrapper because the session has no version
// counter of its own (event versions are tracked on the round + room).

import type { GameSession } from '../game/session.js';
import type { RedisLike } from '../realtime/redisClient.js';

export interface SessionStore {
  get(code: string): Promise<GameSession | null>;
  put(code: string, session: GameSession, ttlSeconds: number): Promise<void>;
  delete(code: string): Promise<void>;
}

export interface SessionStoreOptions {
  keyPrefix?: string;
}

// ─── Upstash impl ─────────────────────────────────────────────────────────────

export function createSessionStore(
  redis: RedisLike,
  options: SessionStoreOptions = {}
): SessionStore {
  const prefix = options.keyPrefix ?? 'session:';
  const k = (code: string) => `${prefix}${code}`;

  return {
    async get(code) {
      const data = await redis.get<GameSession>(k(code));
      return data ?? null;
    },
    async put(code, session, ttlSeconds) {
      await redis.set(k(code), JSON.stringify(session), { ex: ttlSeconds });
    },
    async delete(code) {
      await redis.del(k(code));
    },
  };
}

// ─── Memory impl ──────────────────────────────────────────────────────────────

interface MemoryEntry {
  session: GameSession;
  expiresAt: number | null;
}

export function createMemorySessionStore(
  clock: () => number = Date.now
): SessionStore {
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
      return entry.session;
    },
    async put(code, session, ttlSeconds) {
      store.set(code, {
        session,
        expiresAt: clock() + ttlSeconds * 1000,
      });
    },
    async delete(code) {
      store.delete(code);
    },
  };
}
