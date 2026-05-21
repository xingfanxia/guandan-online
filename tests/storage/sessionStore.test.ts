// Behavior tests for sessionStore (Memory + Upstash impls).
//
// Mirrors roundStore's test surface: get/put roundtrip, delete, TTL, keyPrefix
// isolation. Sessions are simpler than rooms (no atomic-create requirement —
// startGame creates one per game, and the room code is already guaranteed
// unique by roomStore.create's NX semantics).

import { describe, expect, it } from 'vitest';
import {
  createMemorySessionStore,
  createSessionStore,
} from '@lib/storage/sessionStore';
import type { GameSession } from '@lib/game/session';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';
import { createFakeRedis } from '../realtime/_fakeRedis.js';

function sampleSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    teamLevels: { t1: '2', t2: '2' },
    teamAFails: { t1: 0, t2: 0 },
    roundOwner: null,
    finishedRounds: 0,
    phase: 'in_progress',
    winnerTeam: null,
    ...overrides,
  };
}

describe('createMemorySessionStore — get / put roundtrip', () => {
  it('returns null for an unknown code', async () => {
    const store = createMemorySessionStore();
    expect(await store.get('NOTREAL')).toBeNull();
  });

  it('persists and returns a session verbatim', async () => {
    const store = createMemorySessionStore();
    const session = sampleSession({ roundOwner: 't1', finishedRounds: 1 });
    await store.put('A2B3C4', session, 3600);
    const fetched = await store.get('A2B3C4');
    expect(fetched).toEqual(session);
  });

  it('put overwrites a previous value', async () => {
    const store = createMemorySessionStore();
    await store.put('A2B3C4', sampleSession(), 3600);
    await store.put(
      'A2B3C4',
      sampleSession({ teamLevels: { t1: '5', t2: '3' }, finishedRounds: 2 }),
      3600
    );
    const fetched = await store.get('A2B3C4');
    expect(fetched?.teamLevels.t1).toBe('5');
    expect(fetched?.finishedRounds).toBe(2);
  });

  it('TTL expires the session', async () => {
    let now = 1_700_000_000_000;
    const store = createMemorySessionStore(() => now);
    await store.put('A2B3C4', sampleSession(), 60);
    now += 61_000;
    expect(await store.get('A2B3C4')).toBeNull();
  });
});

describe('createMemorySessionStore — delete', () => {
  it('removes a session and subsequent get returns null', async () => {
    const store = createMemorySessionStore();
    await store.put('A2B3C4', sampleSession(), 3600);
    await store.delete('A2B3C4');
    expect(await store.get('A2B3C4')).toBeNull();
  });

  it('is idempotent on unknown code', async () => {
    const store = createMemorySessionStore();
    await expect(store.delete('NEVER')).resolves.toBeUndefined();
  });
});

describe('createSessionStore — Upstash impl roundtrips through RedisLike', () => {
  it('persists and reads a session', async () => {
    const redis = createFakeRedis();
    const store = createSessionStore(redis);
    const session = sampleSession({
      teamLevels: { t1: '7', t2: '2' },
      finishedRounds: 3,
      roundOwner: 't1',
    });
    await store.put('A2B3C4', session, 3600);
    const fetched = await store.get('A2B3C4');
    expect(fetched).toEqual(session);
  });

  it('returns null for missing keys', async () => {
    const store = createSessionStore(createFakeRedis());
    expect(await store.get('NOPE12')).toBeNull();
  });

  it('keyPrefix isolates two stores', async () => {
    const redis = createFakeRedis();
    const a = createSessionStore(redis, { keyPrefix: 'a:' });
    const b = createSessionStore(redis, { keyPrefix: 'b:' });
    await a.put('A2B3C4', sampleSession(), 3600);
    expect(await b.get('A2B3C4')).toBeNull();
    expect(await a.get('A2B3C4')).not.toBeNull();
  });

  it('delete removes the key', async () => {
    const redis = createFakeRedis();
    const store = createSessionStore(redis);
    await store.put('A2B3C4', sampleSession(), 3600);
    await store.delete('A2B3C4');
    expect(await store.get('A2B3C4')).toBeNull();
  });
});
