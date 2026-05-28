// Player-profile persistence — thin Redis wrapper over the RedisLike contract.
//
// A profile is the durable record behind an @handle: when the player first
// appears, when they last played, whether an admin has banned them, and a
// running games-played counter. Mirrors the shape of `roomStore.ts` exactly:
// a Map-backed memory impl for dev / tests and a Redis impl keyed by handle.
//
// SEC-3 uses `banned` to gate joins (a banned handle can't sit down); a
// sibling milestone (player stats / profile page) reuses the same store for
// `gamesPlayed` and `createdAt`, so the surface is kept general rather than
// SEC-3-specific.

import type { RedisLike } from '../realtime/redisClient.js';

export interface PlayerProfile {
  /** Normalized @handle, e.g. "@阿祥". Primary key. */
  readonly handle: string;
  /** Wall-clock ms when this profile was first created. */
  readonly createdAt: number;
  /** Admin ban flag. A banned handle is refused at join time. */
  readonly banned: boolean;
  /** Lifetime games played. Optional — absent on freshly-created profiles. */
  readonly gamesPlayed?: number;
}

export interface ProfileStore {
  /** Returns the profile for `handle`, or null if missing / expired. */
  get(handle: string): Promise<PlayerProfile | null>;
  /** Overwrites the profile. `ttlSeconds` omitted → persist with no expiry. */
  put(profile: PlayerProfile, ttlSeconds?: number): Promise<void>;
  /**
   * Set the ban flag for `handle`. Creates a minimal profile if none exists
   * (so an admin can ban a handle that has never been seen, e.g. proactively).
   * Returns the post-mutation profile.
   */
  setBanned(handle: string, banned: boolean): Promise<PlayerProfile>;
  /** Convenience read of just the ban flag. Missing profile → false. */
  isBanned(handle: string): Promise<boolean>;
  /**
   * Reset the games-played counter to 0. No-op (returns null) when the handle
   * has no profile — there are no stats to reset.
   */
  resetStats(handle: string): Promise<PlayerProfile | null>;
}

export interface ProfileStoreOptions {
  /** Key namespace prefix. Defaults to 'profile:'. */
  keyPrefix?: string;
  /** Wall clock for createdAt on auto-created profiles. Defaults to Date.now. */
  now?: () => number;
}

// ─── Memory implementation ────────────────────────────────────────────────────
//
// Map-backed; profiles vanish on process restart. The TTL handling mirrors
// roomStore.ts: a null expiresAt means "never expires", otherwise the entry
// is dropped once the clock passes expiresAt.

interface MemoryEntry {
  value: PlayerProfile;
  expiresAt: number | null;
}

export function createMemoryProfileStore(
  clock: () => number = Date.now
): ProfileStore {
  const store = new Map<string, MemoryEntry>();

  function alive(entry: MemoryEntry | undefined): entry is MemoryEntry {
    if (!entry) return false;
    if (entry.expiresAt === null) return true;
    return entry.expiresAt > clock();
  }

  function read(handle: string): PlayerProfile | null {
    const entry = store.get(handle);
    if (!alive(entry)) {
      store.delete(handle);
      return null;
    }
    return entry.value;
  }

  function write(value: PlayerProfile, ttlSeconds?: number): void {
    store.set(value.handle, {
      value,
      expiresAt: ttlSeconds === undefined ? null : clock() + ttlSeconds * 1000,
    });
  }

  return {
    async get(handle) {
      return read(handle);
    },
    async put(profile, ttlSeconds) {
      write(profile, ttlSeconds);
    },
    async setBanned(handle, banned) {
      const existing = read(handle);
      const next: PlayerProfile = existing
        ? { ...existing, banned }
        : { handle, createdAt: clock(), banned };
      write(next);
      return next;
    },
    async isBanned(handle) {
      return read(handle)?.banned ?? false;
    },
    async resetStats(handle) {
      const existing = read(handle);
      if (!existing) return null;
      const next: PlayerProfile = { ...existing, gamesPlayed: 0 };
      write(next);
      return next;
    },
  };
}

// ─── Upstash Redis implementation ─────────────────────────────────────────────
//
// One JSON value per handle. setBanned / resetStats are read-modify-write —
// acceptable here because ban/reset are rare admin actions with no concurrent
// writers (unlike the room hash, which the move handler hammers).

export function createProfileStore(
  redis: RedisLike,
  options: ProfileStoreOptions = {}
): ProfileStore {
  const prefix = options.keyPrefix ?? 'profile:';
  const now = options.now ?? Date.now;
  const k = (handle: string) => `${prefix}${handle}`;

  async function read(handle: string): Promise<PlayerProfile | null> {
    const data = await redis.get<PlayerProfile>(k(handle));
    return data ?? null;
  }

  async function write(value: PlayerProfile, ttlSeconds?: number): Promise<void> {
    const opts = ttlSeconds === undefined ? undefined : { ex: ttlSeconds };
    await redis.set(k(value.handle), JSON.stringify(value), opts);
  }

  return {
    get: read,
    async put(profile, ttlSeconds) {
      await write(profile, ttlSeconds);
    },
    async setBanned(handle, banned) {
      const existing = await read(handle);
      const next: PlayerProfile = existing
        ? { ...existing, banned }
        : { handle, createdAt: now(), banned };
      await write(next);
      return next;
    },
    async isBanned(handle) {
      const profile = await read(handle);
      return profile?.banned ?? false;
    },
    async resetStats(handle) {
      const existing = await read(handle);
      if (!existing) return null;
      const next: PlayerProfile = { ...existing, gamesPlayed: 0 };
      await write(next);
      return next;
    },
  };
}
