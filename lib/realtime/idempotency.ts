// Idempotency cache for POST /move retries.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.3 (idempotency-key
// design). Pattern: client generates a UUIDv4 moveId per command. Server
// reserves the key with a PENDING sentinel, processes the command, then
// commits the response. Retries with the same moveId find either PENDING
// (caller should poll/wait) or DONE (return cached response — no re-apply).
//
// In-memory implementation here is suitable for single-instance dev / tests.
// Production uses Upstash Redis SETNX with EX (TTL) — same semantics, different
// transport. Live impl arrives with api/move.ts wiring.

import type { MoveResponse } from './commands';

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
