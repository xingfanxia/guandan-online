// Minimal Redis client contract used by the Upstash-backed realtime impls.
//
// Structurally satisfied by `Redis` from '@upstash/redis' (we only call a
// strict subset of methods) and by the in-memory test fake in
// `tests/realtime/_fakeRedis.ts`. Keeping this surface narrow means the lib
// stays decoupled from `@upstash/redis` version churn and stays testable
// without spinning up a real Redis.
//
// SYNC: docs/research/realtime-sync-deep-dive.md
//   §7.3 — SET NX EX for idempotency reservation
//   §7.5 — Redis Streams (XADD / XRANGE) for the event log + resume protocol

export interface RedisSetOptions {
  /** When true, set only if the key does not already exist (Redis SET ... NX). */
  nx?: boolean;
  /** Expiry in seconds (Redis SET ... EX <seconds>). */
  ex?: number;
}

/**
 * The methods we actually call on Redis. @upstash/redis's `Redis` class
 * satisfies this structurally (TypeScript duck typing).
 */
export interface RedisLike {
  /**
   * SET key value [NX] [EX seconds]. Returns 'OK' on success, null when NX
   * was set and the key already existed.
   */
  set(
    key: string,
    value: string,
    opts?: RedisSetOptions
  ): Promise<'OK' | null>;

  /**
   * GET key. @upstash/redis auto-parses values that look like JSON, returning
   * the parsed object; non-JSON values come back as raw strings. Both shapes
   * are handled by callers.
   */
  get<T = unknown>(key: string): Promise<T | null>;

  /** INCR key. Returns the new value (creates the key at 1 on first call). */
  incr(key: string): Promise<number>;

  /** EXPIRE key seconds. Returns 1 on success, 0 if the key didn't exist. */
  expire(key: string, seconds: number): Promise<number>;

  /** DEL key. Returns 1 if the key existed and was deleted, 0 otherwise. */
  del(key: string): Promise<number>;

  /**
   * XADD key &lt;id|*&gt; field1 value1 ...
   *
   * Pass '*' for auto-assigned stream id (ms-since-epoch + sequence). Pass an
   * explicit id like '42-0' to enforce monotonic numeric ordering — XADD
   * rejects ids ≤ the stream's current top.
   */
  xadd(
    key: string,
    id: '*' | string,
    fields: Record<string, string>
  ): Promise<string | null>;

  /**
   * XRANGE key start end [COUNT n].
   *
   * Range bounds:
   *  - '-' / '+' for full range
   *  - exact stream id (inclusive)
   *  - '(<id>' for exclusive bound (Redis 6.2+, supported by Upstash)
   *
   * Returns an object keyed by stream id, with the field-value map as the
   * value. Insertion-order preserved in the JS object.
   */
  xrange(
    key: string,
    start: string,
    end: string,
    count?: number
  ): Promise<Record<string, Record<string, string>>>;

  /** SADD key member [member ...]. Returns count of newly-added members. */
  sadd(key: string, ...members: string[]): Promise<number>;

  /** SREM key member [member ...]. Returns count of removed members. */
  srem(key: string, ...members: string[]): Promise<number>;

  /** SMEMBERS key. Returns all members of the set (empty array if missing). */
  smembers(key: string): Promise<string[]>;
}
