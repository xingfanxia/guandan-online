// Behavior tests for createUpstashEventLog against the in-memory RedisLike
// fake. Same contract as createMemoryEventLog — sequential numeric ids
// starting at 1, per-room isolation, exclusive fromId semantics.

import { describe, expect, it } from 'vitest';
import { createUpstashEventLog } from '@lib/realtime/eventLog';
import type { ServerEvent } from '@lib/realtime/messages';
import { createFakeRedis } from './_fakeRedis.js';

const heartbeat = (v: number): ServerEvent => ({
  type: 'heartbeat',
  version: v,
  serverTime: '2026-05-18T00:00:00Z',
});

describe('createUpstashEventLog — append + range basics', () => {
  it('append returns sequential ids starting at 1', async () => {
    const log = createUpstashEventLog(createFakeRedis());
    expect(await log.append('room1', heartbeat(1))).toBe(1);
    expect(await log.append('room1', heartbeat(2))).toBe(2);
    expect(await log.append('room1', heartbeat(3))).toBe(3);
  });

  it('range with fromId=null returns all events in order', async () => {
    const log = createUpstashEventLog(createFakeRedis());
    await log.append('room1', heartbeat(1));
    await log.append('room1', heartbeat(2));
    await log.append('room1', heartbeat(3));
    const events = await log.range('room1', null);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(events[0]?.event.version).toBe(1);
  });

  it('range with fromId=N returns events with id > N (exclusive)', async () => {
    const log = createUpstashEventLog(createFakeRedis());
    await log.append('room1', heartbeat(1));
    await log.append('room1', heartbeat(2));
    await log.append('room1', heartbeat(3));
    const events = await log.range('room1', 1);
    expect(events.map((e) => e.id)).toEqual([2, 3]);
  });

  it('range with fromId past the end returns empty', async () => {
    const log = createUpstashEventLog(createFakeRedis());
    await log.append('room1', heartbeat(1));
    const events = await log.range('room1', 99);
    expect(events).toEqual([]);
  });

  it('range on unknown room returns empty', async () => {
    const log = createUpstashEventLog(createFakeRedis());
    const events = await log.range('does-not-exist', null);
    expect(events).toEqual([]);
  });

  it('payloads roundtrip through JSON faithfully', async () => {
    const log = createUpstashEventLog(createFakeRedis());
    const complex: ServerEvent = {
      type: 'move_played',
      version: 42,
      player: 'p1',
      cards: ['5-S-1', 'A-H-2'],
      combinationLabel: 'single',
      nextTurn: 'p2',
      turnDeadline: '2026-05-18T00:01:00Z',
    };
    await log.append('room1', complex);
    const [entry] = await log.range('room1', null);
    expect(entry?.event).toEqual(complex);
  });
});

describe('createUpstashEventLog — per-room isolation', () => {
  it('append to one room does not affect another', async () => {
    const log = createUpstashEventLog(createFakeRedis());
    await log.append('room1', heartbeat(1));
    await log.append('room2', heartbeat(2));
    const events1 = await log.range('room1', null);
    const events2 = await log.range('room2', null);
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    // R-C1: id is the event.version, not an independent per-room counter.
    expect(events1[0]?.id).toBe(1);
    expect(events2[0]?.id).toBe(2);
  });

  it('different keyPrefix instances do not collide', async () => {
    const redis = createFakeRedis();
    const a = createUpstashEventLog(redis, { keyPrefix: 'a:' });
    const b = createUpstashEventLog(redis, { keyPrefix: 'b:' });
    await a.append('room1', heartbeat(1));
    await a.append('room1', heartbeat(2));
    const bEvents = await b.range('room1', null);
    expect(bEvents).toEqual([]);
    const aEvents = await a.range('room1', null);
    expect(aEvents).toHaveLength(2);
  });
});

describe('createUpstashEventLog — TTL refresh', () => {
  it('refreshes TTL on the stream + seq keys on each append', async () => {
    const redis = createFakeRedis();
    const log = createUpstashEventLog(redis, { ttlSeconds: 60 });
    // The fake's expire() returns 1 when the key exists. We can't directly
    // observe TTL, but exercising the path proves it doesn't throw.
    await log.append('room1', heartbeat(1));
    await log.append('room1', heartbeat(2));
    const events = await log.range('room1', null);
    expect(events).toHaveLength(2);
  });
});
