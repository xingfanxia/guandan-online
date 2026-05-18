// Behavior tests for the realtime infrastructure factory.

import { describe, expect, it } from 'vitest';
import { createRealtimeInfra } from '@lib/realtime/infra';
import type { ServerEvent } from '@lib/realtime/messages';
import { createFakeRedis } from './_fakeRedis';

const event = (v: number): ServerEvent => ({
  type: 'heartbeat',
  version: v,
  serverTime: '2026-05-18T00:00:00Z',
});

describe('createRealtimeInfra — memory backend (no env)', () => {
  it('returns backend=memory when env vars are missing', () => {
    const infra = createRealtimeInfra({});
    expect(infra.backend).toBe('memory');
  });

  it('returns backend=memory when only URL is set', () => {
    const infra = createRealtimeInfra({ UPSTASH_REDIS_REST_URL: 'x' });
    expect(infra.backend).toBe('memory');
  });

  it('memory log appends and ranges as expected', async () => {
    const { log } = createRealtimeInfra({});
    await log.append('room1', event(1));
    await log.append('room1', event(2));
    const events = await log.range('room1', null);
    expect(events.map((e) => e.id)).toEqual([1, 2]);
  });

  it('memory idempotency reserves and commits as expected', async () => {
    const { idempotency } = createRealtimeInfra({});
    expect((await idempotency.tryReserve('m', 300)).status).toBe('reserved');
    await idempotency.commit(
      'm',
      { ok: true, appliedVersion: 1, result: 'applied' },
      300
    );
    const r = await idempotency.tryReserve('m', 300);
    expect(r.status).toBe('done');
  });
});

describe('createRealtimeInfra — upstash backend (injected redis)', () => {
  it('returns backend=upstash when a RedisLike is injected', () => {
    const redis = createFakeRedis();
    const infra = createRealtimeInfra({}, { redis });
    expect(infra.backend).toBe('upstash');
  });

  it('upstash log writes through the injected redis', async () => {
    const redis = createFakeRedis();
    const { log } = createRealtimeInfra({}, { redis });
    await log.append('room1', event(1));
    await log.append('room1', event(2));
    const events = await log.range('room1', null);
    expect(events.map((e) => e.id)).toEqual([1, 2]);
    // Sanity: stream key actually populated in the fake.
    expect(redis.__peekStream('events:room1')).toHaveLength(2);
  });

  it('upstash idempotency stores the PENDING sentinel in the fake', async () => {
    const redis = createFakeRedis();
    const { idempotency } = createRealtimeInfra({}, { redis });
    await idempotency.tryReserve('move-x', 300);
    expect(redis.__peek('idem:move-x')).toBe('PENDING');
  });
});
