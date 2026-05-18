// In-memory RedisLike fake for behavior tests of the Upstash realtime impls.
//
// Goals:
//   - Mirror the parts of @upstash/redis semantics we depend on (NX, EX,
//     auto-JSON-parsing GET, stream XADD/XRANGE with exclusive '(<id>' bound).
//   - Be tiny — we only need it for unit tests; a real Upstash instance
//     covers integration.
//   - Make time controllable so TTL expiry tests don't need real wall-clock
//     delays.
//
// Not a faithful Redis simulator: skips many commands and edge cases. If a
// real lib call hits something this fake doesn't model, the test will fail
// with a clear error — that's a feature, not a bug.

import type { RedisLike, RedisSetOptions } from '@lib/realtime/redisClient';

export interface FakeRedis extends RedisLike {
  /** Advance the fake clock by `ms` milliseconds. */
  advanceTime(ms: number): void;
  /** Read the underlying value for assertions in tests. */
  __peek(key: string): string | null;
  /** Read the raw stream entries for assertions in tests. */
  __peekStream(key: string): Array<[string, Record<string, string>]>;
}

interface Entry {
  value: string;
  expiresAt: number | null;
}

export function createFakeRedis(): FakeRedis {
  const data = new Map<string, Entry>();
  const streams = new Map<string, Array<[string, Record<string, string>]>>();
  const counters = new Map<string, number>();
  let now = 1_700_000_000_000; // arbitrary fixed epoch; tests advance it explicitly

  function alive(entry: Entry | undefined): entry is Entry {
    if (!entry) return false;
    if (entry.expiresAt === null) return true;
    return entry.expiresAt > now;
  }

  function compareStreamId(a: string, b: string): number {
    const [aMs, aSeq] = parsePair(a);
    const [bMs, bSeq] = parsePair(b);
    if (aMs !== bMs) return aMs - bMs;
    return aSeq - bSeq;
  }
  function parsePair(id: string): [number, number] {
    const dash = id.indexOf('-');
    if (dash < 0) return [Number(id), 0];
    return [Number(id.slice(0, dash)), Number(id.slice(dash + 1))];
  }

  return {
    advanceTime(ms) {
      now += ms;
    },
    __peek(key) {
      const e = data.get(key);
      if (!alive(e)) return null;
      return e.value;
    },
    __peekStream(key) {
      return [...(streams.get(key) ?? [])];
    },

    async set(key: string, value: string, opts: RedisSetOptions = {}) {
      const existing = data.get(key);
      if (opts.nx && alive(existing)) {
        return null;
      }
      const expiresAt = opts.ex !== undefined ? now + opts.ex * 1000 : null;
      data.set(key, { value, expiresAt });
      return 'OK' as const;
    },

    async get<T = unknown>(key: string): Promise<T | null> {
      const entry = data.get(key);
      if (!alive(entry)) {
        data.delete(key);
        return null;
      }
      try {
        return JSON.parse(entry.value) as T;
      } catch {
        return entry.value as unknown as T;
      }
    },

    async incr(key: string): Promise<number> {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      // Mirror Redis semantics: INCR refreshes nothing about TTL on data keys,
      // but we represent counter as a stand-alone numeric cell so the data
      // map stays out of it. Tests don't expire counters yet.
      return next;
    },

    async expire(key: string, seconds: number): Promise<number> {
      const entry = data.get(key);
      if (entry) {
        entry.expiresAt = now + seconds * 1000;
        return 1;
      }
      const stream = streams.get(key);
      if (stream) {
        // Streams have no real expiry in this fake, but return 1 to mirror
        // what Upstash would return on a present stream key.
        return 1;
      }
      const counter = counters.get(key);
      if (counter !== undefined) {
        return 1;
      }
      return 0;
    },

    async xadd(
      key: string,
      id: '*' | string,
      fields: Record<string, string>
    ): Promise<string | null> {
      const stream = streams.get(key) ?? [];
      let assigned: string;
      if (id === '*') {
        const seq = stream.length === 0 ? 0 : (parsePair(stream[stream.length - 1]![0])[0] === now
          ? parsePair(stream[stream.length - 1]![0])[1] + 1
          : 0);
        assigned = `${now}-${seq}`;
      } else {
        if (stream.length > 0 && compareStreamId(id, stream[stream.length - 1]![0]) <= 0) {
          return null; // Redis would reject; mirror by returning null
        }
        assigned = id;
      }
      stream.push([assigned, { ...fields }]);
      streams.set(key, stream);
      return assigned;
    },

    async xrange(
      key: string,
      start: string,
      end: string,
      count?: number
    ): Promise<Record<string, Record<string, string>>> {
      const stream = streams.get(key) ?? [];
      const startExclusive = start.startsWith('(');
      const startId = startExclusive ? start.slice(1) : start;
      const endExclusive = end.startsWith('(');
      const endId = endExclusive ? end.slice(1) : end;

      const matches: Array<[string, Record<string, string>]> = [];
      for (const [id, fields] of stream) {
        let okStart: boolean;
        if (startId === '-') okStart = true;
        else if (startExclusive) okStart = compareStreamId(id, startId) > 0;
        else okStart = compareStreamId(id, startId) >= 0;

        let okEnd: boolean;
        if (endId === '+') okEnd = true;
        else if (endExclusive) okEnd = compareStreamId(id, endId) < 0;
        else okEnd = compareStreamId(id, endId) <= 0;

        if (okStart && okEnd) matches.push([id, { ...fields }]);
      }
      const sliced = count !== undefined ? matches.slice(0, count) : matches;
      const result: Record<string, Record<string, string>> = {};
      for (const [id, fields] of sliced) result[id] = fields;
      return result;
    },
  };
}
