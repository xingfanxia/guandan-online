// Behavior tests for createUpstashEventBus against the in-memory RedisLike
// fake. The Upstash variant is polling-based (no real SUBSCRIBE on the REST
// client), so tests use vitest fake timers to step the poll loop manually.
//
// Contract (matches createMemoryEventBus modulo delivery latency):
//   - live-only fanout — publishes BEFORE subscribe are NOT replayed
//   - same-channel publishes after subscribe deliver to the handler
//   - cross-channel publishes do not leak
//   - unsubscribe halts further delivery
//   - a throwing handler does not break the loop

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUpstashEventBus } from '@lib/realtime/eventBus';
import type { ServerEvent } from '@lib/realtime/messages';
import { createFakeRedis } from './_fakeRedis.js';

const sampleEvent: ServerEvent = {
  type: 'heartbeat',
  version: 1,
  serverTime: '2026-05-18T00:00:00Z',
};
const otherEvent: ServerEvent = {
  type: 'heartbeat',
  version: 2,
  serverTime: '2026-05-18T00:00:01Z',
};

const POLL = 100;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createUpstashEventBus — live-only fanout', () => {
  it('delivers a same-channel publish after the next poll', async () => {
    const redis = createFakeRedis();
    const bus = createUpstashEventBus(redis, { pollIntervalMs: POLL });
    const handler = vi.fn();
    await bus.subscribe('chan', handler);

    await bus.publish('chan', sampleEvent);
    redis.advanceTime(1); // ensure new XADD id is strictly later than seed
    await vi.advanceTimersByTimeAsync(POLL);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(sampleEvent);
  });

  it('does NOT replay events published before subscribe', async () => {
    const redis = createFakeRedis();
    const bus = createUpstashEventBus(redis, { pollIntervalMs: POLL });
    await bus.publish('chan', sampleEvent);
    redis.advanceTime(1);

    const handler = vi.fn();
    await bus.subscribe('chan', handler);
    await vi.advanceTimersByTimeAsync(POLL * 3);

    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers multiple events in order across successive polls', async () => {
    const redis = createFakeRedis();
    const bus = createUpstashEventBus(redis, { pollIntervalMs: POLL });
    const handler = vi.fn();
    await bus.subscribe('chan', handler);

    await bus.publish('chan', sampleEvent);
    redis.advanceTime(1);
    await bus.publish('chan', otherEvent);
    redis.advanceTime(1);

    await vi.advanceTimersByTimeAsync(POLL);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]?.[0]).toEqual(sampleEvent);
    expect(handler.mock.calls[1]?.[0]).toEqual(otherEvent);
  });
});

describe('createUpstashEventBus — channel isolation', () => {
  it('publishes on a different channel never deliver', async () => {
    const redis = createFakeRedis();
    const bus = createUpstashEventBus(redis, { pollIntervalMs: POLL });
    const handler = vi.fn();
    await bus.subscribe('chan-a', handler);

    await bus.publish('chan-b', sampleEvent);
    redis.advanceTime(1);
    await vi.advanceTimersByTimeAsync(POLL * 3);

    expect(handler).not.toHaveBeenCalled();
  });

  it('two subscribers on the same channel both receive', async () => {
    const redis = createFakeRedis();
    const bus = createUpstashEventBus(redis, { pollIntervalMs: POLL });
    const h1 = vi.fn();
    const h2 = vi.fn();
    await bus.subscribe('chan', h1);
    await bus.subscribe('chan', h2);

    await bus.publish('chan', sampleEvent);
    redis.advanceTime(1);
    await vi.advanceTimersByTimeAsync(POLL);

    expect(h1).toHaveBeenCalledWith(sampleEvent);
    expect(h2).toHaveBeenCalledWith(sampleEvent);
  });
});

describe('createUpstashEventBus — unsubscribe', () => {
  it('stops delivery after unsubscribe', async () => {
    const redis = createFakeRedis();
    const bus = createUpstashEventBus(redis, { pollIntervalMs: POLL });
    const handler = vi.fn();
    const unsubscribe = await bus.subscribe('chan', handler);

    await bus.publish('chan', sampleEvent);
    redis.advanceTime(1);
    await vi.advanceTimersByTimeAsync(POLL);
    expect(handler).toHaveBeenCalledTimes(1);

    await unsubscribe();
    await bus.publish('chan', otherEvent);
    redis.advanceTime(1);
    await vi.advanceTimersByTimeAsync(POLL * 5);
    expect(handler).toHaveBeenCalledTimes(1); // no new delivery after unsub
  });

  it('unsubscribe is idempotent', async () => {
    const redis = createFakeRedis();
    const bus = createUpstashEventBus(redis, { pollIntervalMs: POLL });
    const handler = vi.fn();
    const unsubscribe = await bus.subscribe('chan', handler);
    await unsubscribe();
    await expect(unsubscribe()).resolves.toBeUndefined();
  });
});

describe('createUpstashEventBus — error containment', () => {
  it('a throwing handler does not stop subsequent deliveries', async () => {
    const redis = createFakeRedis();
    const bus = createUpstashEventBus(redis, { pollIntervalMs: POLL });
    const bad = vi.fn().mockImplementation(() => {
      throw new Error('handler crash');
    });
    await bus.subscribe('chan', bad);

    await bus.publish('chan', sampleEvent);
    redis.advanceTime(1);
    await bus.publish('chan', otherEvent);
    redis.advanceTime(1);
    await vi.advanceTimersByTimeAsync(POLL);

    expect(bad).toHaveBeenCalledTimes(2);
  });

  it('a throwing handler does not block sibling subscribers', async () => {
    const redis = createFakeRedis();
    const bus = createUpstashEventBus(redis, { pollIntervalMs: POLL });
    const bad = vi.fn().mockImplementation(() => {
      throw new Error('handler crash');
    });
    const good = vi.fn();
    await bus.subscribe('chan', bad);
    await bus.subscribe('chan', good);

    await bus.publish('chan', sampleEvent);
    redis.advanceTime(1);
    await vi.advanceTimersByTimeAsync(POLL);

    expect(bad).toHaveBeenCalledWith(sampleEvent);
    expect(good).toHaveBeenCalledWith(sampleEvent);
  });
});

describe('createUpstashEventBus — auto-deserialization (prod SSE black-screen regression)', () => {
  // Real @upstash/redis JSON-parses stream field values on read, so tick()
  // receives `fields['data']` as an already-parsed object. Pre-fix tick()
  // called JSON.parse on that object, threw "[object Object]" is not valid
  // JSON, and the catch swallowed it — every LIVE event silently dropped, the
  // game table rendered empty. This pins the parsed-object delivery contract.
  it('delivers the parsed event object, not a JSON string', async () => {
    const redis = createFakeRedis();
    const bus = createUpstashEventBus(redis, { pollIntervalMs: POLL });
    const handler = vi.fn();
    await bus.subscribe('chan', handler);

    await bus.publish('chan', sampleEvent);
    redis.advanceTime(1);
    await vi.advanceTimersByTimeAsync(POLL);

    expect(handler).toHaveBeenCalledTimes(1);
    const delivered = handler.mock.calls[0]?.[0];
    expect(typeof delivered).toBe('object');
    expect(delivered).toEqual(sampleEvent);
  });
});
