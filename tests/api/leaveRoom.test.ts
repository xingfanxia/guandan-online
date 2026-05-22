// Behavior tests for handleLeaveRoom.

import { describe, expect, it } from 'vitest';
import { handleLeaveRoom } from '@lib/api/leaveRoom';
import { handleJoinRoom, type JoinRoomResponseBody } from '@lib/api/joinRoom';
import { handleCreateRoom, type CreateRoomResponseBody } from '@lib/api/createRoom';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import type { RateLimiter } from '@lib/security/rateLimit';

function req(method: string, body: unknown, bearer?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  return new Request('http://test/', {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const CODE = 'A2B3C4';

/** Build a fully populated room with host + one joiner. Returns the store +
 *  tokens for both members so tests can authenticate as either. */
async function seedRoomWithJoiner() {
  const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
  const createDeps = {
    roomStore,
    tokenGen: counter('tok'),
    codeGen: () => CODE,
    now: () => 1_700_000_000_000,
  };
  const createRes = await handleCreateRoom(
    req('POST', { mode: '4', host: { handle: '@host' } }),
    createDeps
  );
  const create = (await createRes.json()) as CreateRoomResponseBody;

  const joinDeps = {
    roomStore,
    tokenGen: counter('joiner'),
    now: () => 1_700_000_000_000,
  };
  const joinRes = await handleJoinRoom(
    req('POST', { handle: '@fufu' }),
    CODE,
    joinDeps
  );
  const join = (await joinRes.json()) as JoinRoomResponseBody;

  return {
    roomStore,
    hostJoinToken: create.hostJoinToken,
    joinerToken: join.joinToken,
  };
}

describe('handleLeaveRoom — non-host leaves', () => {
  it('returns 200 ok and removes the member', async () => {
    const { roomStore, joinerToken } = await seedRoomWithJoiner();
    const res = await handleLeaveRoom(
      req('POST', {}, joinerToken),
      CODE,
      { roomStore }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; dissolved?: true };
    expect(body.ok).toBe(true);
    expect(body.dissolved).toBeUndefined();

    const state = await roomStore.get(CODE);
    expect(state?.members).toHaveLength(1);
    expect(state?.members[0]?.handle).toBe('host');
  });
});

describe('handleLeaveRoom — host leaves', () => {
  it('returns dissolved=true and removes the room from storage', async () => {
    const { roomStore, hostJoinToken } = await seedRoomWithJoiner();
    const res = await handleLeaveRoom(
      req('POST', {}, hostJoinToken),
      CODE,
      { roomStore }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; dissolved?: true };
    expect(body.dissolved).toBe(true);
    expect(await roomStore.get(CODE)).toBeNull();
  });
});

describe('handleLeaveRoom — auth', () => {
  it('rejects without a bearer token', async () => {
    const { roomStore } = await seedRoomWithJoiner();
    const res = await handleLeaveRoom(req('POST', {}), CODE, { roomStore });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown bearer token', async () => {
    const { roomStore } = await seedRoomWithJoiner();
    const res = await handleLeaveRoom(
      req('POST', {}, 'not-a-real-token'),
      CODE,
      { roomStore }
    );
    expect(res.status).toBe(401);
  });
});

describe('handleLeaveRoom — input validation', () => {
  it('rejects non-POST', async () => {
    const { roomStore, joinerToken } = await seedRoomWithJoiner();
    const res = await handleLeaveRoom(
      req('DELETE', undefined, joinerToken),
      CODE,
      { roomStore }
    );
    expect(res.status).toBe(405);
  });

  it('rejects malformed room code', async () => {
    const { roomStore, joinerToken } = await seedRoomWithJoiner();
    const res = await handleLeaveRoom(
      req('POST', {}, joinerToken),
      'BAD',
      { roomStore }
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown room', async () => {
    const { joinerToken } = await seedRoomWithJoiner();
    const empty = createMemoryRoomStore();
    const res = await handleLeaveRoom(
      req('POST', {}, joinerToken),
      'D5E6F7',
      { roomStore: empty }
    );
    expect(res.status).toBe(404);
  });
});

// ─── R-I5 regression — rate limit on /leave ─────────────────────────────────

describe('handleLeaveRoom — R-I5: rate limit', () => {
  it('returns 429 when limiter denies', async () => {
    const { roomStore, joinerToken } = await seedRoomWithJoiner();
    const tightLimiter: RateLimiter = {
      check() {
        return { allowed: false, retryAfterMs: 2000 };
      },
    };
    const res = await handleLeaveRoom(
      req('POST', {}, joinerToken),
      CODE,
      { roomStore, rateLimiter: tightLimiter }
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('2');
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('rate_limited');
  });
});
