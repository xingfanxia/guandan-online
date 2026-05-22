import { describe, expect, it } from 'vitest';
import { createMemoryEventLog } from '@lib/realtime/eventLog';
import type { ServerEvent } from '@lib/realtime/messages';

const heartbeat = (v: number): ServerEvent => ({
  type: 'heartbeat',
  version: v,
  serverTime: '2026-05-18T00:00:00Z',
});

describe('createMemoryEventLog — append + range basics', () => {
  it('append returns sequential ids starting at 1', async () => {
    const log = createMemoryEventLog();
    const id1 = await log.append('room1', heartbeat(1));
    const id2 = await log.append('room1', heartbeat(2));
    const id3 = await log.append('room1', heartbeat(3));
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(id3).toBe(3);
  });

  it('range with fromId=null returns all events in order', async () => {
    const log = createMemoryEventLog();
    await log.append('room1', heartbeat(1));
    await log.append('room1', heartbeat(2));
    await log.append('room1', heartbeat(3));
    const events = await log.range('room1', null);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(events[0]?.event.version).toBe(1);
  });

  it('range with fromId=N returns events with id > N (exclusive)', async () => {
    const log = createMemoryEventLog();
    await log.append('room1', heartbeat(1));
    await log.append('room1', heartbeat(2));
    await log.append('room1', heartbeat(3));
    const events = await log.range('room1', 1);
    expect(events.map((e) => e.id)).toEqual([2, 3]);
  });

  it('range with fromId past the end returns empty', async () => {
    const log = createMemoryEventLog();
    await log.append('room1', heartbeat(1));
    const events = await log.range('room1', 99);
    expect(events).toEqual([]);
  });

  it('range on unknown room returns empty', async () => {
    const log = createMemoryEventLog();
    const events = await log.range('does-not-exist', null);
    expect(events).toEqual([]);
  });
});

describe('createMemoryEventLog — per-room isolation', () => {
  it('append to one room does not affect another room', async () => {
    const log = createMemoryEventLog();
    await log.append('room1', heartbeat(1));
    await log.append('room2', heartbeat(2));
    const events1 = await log.range('room1', null);
    const events2 = await log.range('room2', null);
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    // R-C1: id is the event.version, not an independent per-room counter.
    // The two rooms get DIFFERENT ids because their events have different
    // version numbers (1 vs 2 above).
    expect(events1[0]?.id).toBe(1);
    expect(events2[0]?.id).toBe(2);
  });
});

describe('createMemoryEventLog — MAXLEN trimming', () => {
  it('with maxPerRoom=3, only the 3 most recent events are kept', async () => {
    const log = createMemoryEventLog({ maxPerRoom: 3 });
    for (let i = 1; i <= 5; i++) {
      await log.append('room1', heartbeat(i));
    }
    const events = await log.range('room1', null);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.id)).toEqual([3, 4, 5]);
  });

  it('without maxPerRoom, the log grows unbounded (no trim)', async () => {
    const log = createMemoryEventLog();
    for (let i = 1; i <= 50; i++) {
      await log.append('room1', heartbeat(i));
    }
    const events = await log.range('room1', null);
    expect(events).toHaveLength(50);
  });
});
