import { describe, expect, it, vi } from 'vitest';
import { createMemoryEventBus } from '@lib/realtime/eventBus';
import type { ServerEvent } from '@lib/realtime/messages';

const sampleEvent: ServerEvent = {
  type: 'heartbeat',
  version: 1,
  serverTime: '2026-05-18T00:00:00Z',
};

describe('createMemoryEventBus — publish/subscribe basics', () => {
  it('delivers a published event to a subscriber on the same channel', async () => {
    const bus = createMemoryEventBus();
    const handler = vi.fn();
    await bus.subscribe('room:1:player:p1', handler);
    await bus.publish('room:1:player:p1', sampleEvent);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(sampleEvent);
  });

  it('does NOT deliver events on a different channel', async () => {
    const bus = createMemoryEventBus();
    const handler = vi.fn();
    await bus.subscribe('room:1:player:p1', handler);
    await bus.publish('room:1:player:p2', sampleEvent);
    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers to multiple subscribers on the same channel', async () => {
    const bus = createMemoryEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    await bus.subscribe('chan', h1);
    await bus.subscribe('chan', h2);
    await bus.publish('chan', sampleEvent);
    expect(h1).toHaveBeenCalledWith(sampleEvent);
    expect(h2).toHaveBeenCalledWith(sampleEvent);
  });

  it('unsubscribe stops further delivery to that handler', async () => {
    const bus = createMemoryEventBus();
    const handler = vi.fn();
    const unsubscribe = await bus.subscribe('chan', handler);
    await bus.publish('chan', sampleEvent);
    await unsubscribe();
    await bus.publish('chan', sampleEvent);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe is idempotent (calling twice is a no-op)', async () => {
    const bus = createMemoryEventBus();
    const handler = vi.fn();
    const unsubscribe = await bus.subscribe('chan', handler);
    await unsubscribe();
    await unsubscribe(); // should not throw
    await bus.publish('chan', sampleEvent);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('createMemoryEventBus — isolation between instances', () => {
  it('two separate buses do not share state', async () => {
    const a = createMemoryEventBus();
    const b = createMemoryEventBus();
    const handler = vi.fn();
    await a.subscribe('chan', handler);
    await b.publish('chan', sampleEvent);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('createMemoryEventBus — error handling', () => {
  it('a throwing handler does not prevent other subscribers from receiving', async () => {
    const bus = createMemoryEventBus();
    const bad = vi.fn().mockImplementation(() => {
      throw new Error('handler crash');
    });
    const good = vi.fn();
    await bus.subscribe('chan', bad);
    await bus.subscribe('chan', good);
    await bus.publish('chan', sampleEvent);
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalledWith(sampleEvent);
  });
});
