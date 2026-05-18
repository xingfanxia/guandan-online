// Idempotency cache for POST /move retries.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.3 (idempotency-key
// design). Pattern: client generates a UUIDv4 moveId per command. Server
// reserves the key with a PENDING sentinel, processes the command, then
// commits the response. Retries with the same moveId find either PENDING
// (caller should poll/wait) or DONE (return cached response — no re-apply).
//
// Two implementations target this contract:
//   - createMemoryIdempotencyCache() — in-process Map; used in tests + dev
//   - createUpstashIdempotencyCache(redis) — backed by Upstash Redis via
//     SET NX EX. Live impl wired by api/move.ts in production.

import type { MoveResponse } from './commands';
import type { RedisLike } from './redisClient';

export type ReserveResult =
  | { status: 'reserved' }
  | { status: 'pending' }
  | { status: 'done'; result: MoveResponse };

export interface IdempotencyCache {
  /**
   * Atomic check-and-set. Returns:
   *  - 'reserved' if the moveId was brand new — caller should process now
   *  - 'pending' if another worker has reserved but not committed yet
   *  - 'done' with the cached MoveResponse if a previous worker committed
   */
  tryReserve(moveId: string, ttlSeconds: number): Promise<ReserveResult>;
  /** Mark a previously-reserved moveId as done. Throws if not reserved or already committed. */
  commit(moveId: string, result: MoveResponse, ttlSeconds: number): Promise<void>;
}

type Entry =
  | { status: 'pending'; expiresAt: number }
  | { status: 'done'; result: MoveResponse; expiresAt: number };

export function createMemoryIdempotencyCache(
  clock: () => number = Date.now
): IdempotencyCache {
  const store = new Map<string, Entry>();

  function purgeIfExpired(moveId: string): void {
    const entry = store.get(moveId);
    if (!entry) return;
    if (entry.expiresAt <= clock()) {
      store.delete(moveId);
    }
  }

  return {
    tryReserve(moveId, ttlSeconds) {
      purgeIfExpired(moveId);
      const existing = store.get(moveId);
      if (!existing) {
        store.set(moveId, {
          status: 'pending',
          expiresAt: clock() + ttlSeconds * 1000,
        });
        return Promise.resolve({ status: 'reserved' as const });
      }
      if (existing.status === 'pending') {
        return Promise.resolve({ status: 'pending' as const });
      }
      return Promise.resolve({
        status: 'done' as const,
        result: existing.result,
      });
    },

    commit(moveId, result, ttlSeconds) {
      const existing = store.get(moveId);
      if (!existing) {
        return Promise.reject(
          new Error(`commit: ${moveId} not reserved (or expired before commit)`)
        );
      }
      if (existing.status === 'done') {
        return Promise.reject(new Error(`commit: ${moveId} already committed`));
      }
      store.set(moveId, {
        status: 'done',
        result,
        expiresAt: clock() + ttlSeconds * 1000,
      });
      return Promise.resolve();
    },
  };
}

// ─── Upstash Redis implementation ─────────────────────────────────────────────
//
// Wire protocol per moveId:
//   1. tryReserve  → SET key 'PENDING' NX EX <ttl>
//        - 'OK'  → reservation acquired, return 'reserved'
//        - null  → key already exists, follow up with GET to disambiguate
//                  PENDING (status 'pending') vs JSON (status 'done')
//   2. commit      → SET key JSON.stringify(result) EX <ttl>
//                    (after a GET to enforce contract: must be in PENDING
//                    state; not-reserved and already-committed both throw)
//
// Upstash GET auto-parses JSON, so a done entry comes back as the parsed
// MoveResponse object; the PENDING sentinel comes back as the raw string.

const PENDING_SENTINEL = 'PENDING';

export function createUpstashIdempotencyCache(
  redis: RedisLike,
  keyPrefix = 'idem:'
): IdempotencyCache {
  const k = (moveId: string) => `${keyPrefix}${moveId}`;

  return {
    async tryReserve(moveId, ttlSeconds) {
      const reserved = await redis.set(k(moveId), PENDING_SENTINEL, {
        nx: true,
        ex: ttlSeconds,
      });
      if (reserved === 'OK') {
        return { status: 'reserved' };
      }
      const existing = await redis.get<unknown>(k(moveId));
      if (existing === null) {
        // Race: NX failed (entry existed) but a concurrent expiry then
        // removed it before our follow-up GET. Treat as a fresh reservation.
        const reserve2 = await redis.set(k(moveId), PENDING_SENTINEL, {
          nx: true,
          ex: ttlSeconds,
        });
        return reserve2 === 'OK'
          ? { status: 'reserved' }
          : { status: 'pending' };
      }
      if (existing === PENDING_SENTINEL || typeof existing === 'string') {
        return { status: 'pending' };
      }
      // Existing is the parsed MoveResponse object.
      return { status: 'done', result: existing as MoveResponse };
    },

    async commit(moveId, result, ttlSeconds) {
      const existing = await redis.get<unknown>(k(moveId));
      if (existing === null) {
        throw new Error(
          `commit: ${moveId} not reserved (or expired before commit)`
        );
      }
      if (existing !== PENDING_SENTINEL && typeof existing !== 'string') {
        throw new Error(`commit: ${moveId} already committed`);
      }
      await redis.set(k(moveId), JSON.stringify(result), { ex: ttlSeconds });
    },
  };
}
