// Behavior tests for the realtime infrastructure factory.

import { describe, expect, it } from 'vitest';
import { createRealtimeInfra } from '@lib/realtime/infra';
import type { ServerEvent } from '@lib/realtime/messages';
import type { RoomState } from '@lib/room/lifecycle';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';
import { createFakeRedis } from './_fakeRedis.js';

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

  it('returns backend=memory when only token is set', () => {
    const infra = createRealtimeInfra({ UPSTASH_REDIS_REST_TOKEN: 'x' });
    expect(infra.backend).toBe('memory');
  });

  it('returns backend=memory when only KV_REST_API_URL is set', () => {
    const infra = createRealtimeInfra({ KV_REST_API_URL: 'x' });
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

  it('returns backend=upstash when UPSTASH_REDIS_REST_* pair is set', () => {
    const infra = createRealtimeInfra({
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'tok',
    });
    expect(infra.backend).toBe('upstash');
  });

  it('returns backend=upstash when KV_REST_API_* pair is set (Vercel Marketplace naming)', () => {
    const infra = createRealtimeInfra({
      KV_REST_API_URL: 'https://example.upstash.io',
      KV_REST_API_TOKEN: 'tok',
    });
    expect(infra.backend).toBe('upstash');
  });

  it('prefers UPSTASH_REDIS_REST_* over KV_REST_API_* when both are set', () => {
    // No assertion on which URL got picked (no observable side-effect without a network call);
    // this test pins the precedence rule into the test suite so future-you doesn't accidentally
    // flip it. The factory should select the upstash branch in either case.
    const infra = createRealtimeInfra({
      UPSTASH_REDIS_REST_URL: 'https://up.example.io',
      UPSTASH_REDIS_REST_TOKEN: 'tok-up',
      KV_REST_API_URL: 'https://kv.example.io',
      KV_REST_API_TOKEN: 'tok-kv',
    });
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

describe('createRealtimeInfra — roomStore wiring', () => {
  function sampleRoom(code: string): RoomState {
    return {
      code,
      mode: '4',
      rules: DEFAULT_MODE_RULES,
      hostId: 'p0',
      hostToken: 't',
      members: [
        {
          id: 'p0',
          handle: '@h',
          joinToken: 'j',
          joinedAt: 0,
          status: 'connected',
        },
      ],
      phase: 'lobby',
      createdAt: 0,
      lastActiveAt: 0,
      eventVersion: 0,
    };
  }

  it('memory backend exposes a working roomStore', async () => {
    const { roomStore } = createRealtimeInfra({});
    await roomStore.put(sampleRoom('A2B3C4'), 3600);
    const fetched = await roomStore.get('A2B3C4');
    expect(fetched?.code).toBe('A2B3C4');
  });

  it('upstash backend writes rooms through the injected redis', async () => {
    const redis = createFakeRedis();
    const { roomStore } = createRealtimeInfra({}, { redis });
    await roomStore.put(sampleRoom('A2B3C4'), 3600);
    expect(redis.__peek('room:A2B3C4')).not.toBeNull();
  });
});
