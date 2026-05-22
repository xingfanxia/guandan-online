// Behavior tests for handleJoinRoom.

import { describe, expect, it } from 'vitest';
import {
  handleJoinRoom,
  type JoinRoomResponseBody,
} from '@lib/api/joinRoom';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import { handleCreateRoom } from '@lib/api/createRoom';
import type { RateLimiter } from '@lib/security/rateLimit';

function req(method: string, body: unknown, url = 'http://test/'): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

// 6-char L D L D L D pattern, ambiguity-safe alphabet. Sample valid codes.
const VALID_CODES = ['A2B3C4', 'D5E6F7', 'G8H9J2'];

async function seedRoom(code: string) {
  const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
  const deps = {
    roomStore,
    tokenGen: counter('tok'),
    codeGen: () => code,
    now: () => 1_700_000_000_000,
  };
  await handleCreateRoom(
    req('POST', { mode: '4', host: { handle: '@host' } }),
    deps
  );
  return roomStore;
}

describe('handleJoinRoom — happy path', () => {
  it('returns 200 with playerId and joinToken', async () => {
    const code = VALID_CODES[0]!;
    const roomStore = await seedRoom(code);
    const res = await handleJoinRoom(req('POST', { handle: '@fufu' }), code, {
      roomStore,
      tokenGen: counter('joiner'),
      now: () => 1_700_000_000_000,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as JoinRoomResponseBody;
    expect(body.playerId).toBe('p1');
    expect(body.joinToken).toBe('joiner-1');
  });

  it('appends the joiner to room.members', async () => {
    const code = VALID_CODES[0]!;
    const roomStore = await seedRoom(code);
    await handleJoinRoom(req('POST', { handle: '@fufu' }), code, { roomStore });
    const state = await roomStore.get(code);
    expect(state?.members).toHaveLength(2);
    expect(state?.members[1]?.handle).toBe('fufu');
  });

  it('assigns sequential player ids p0, p1, p2 ...', async () => {
    const code = VALID_CODES[0]!;
    const roomStore = await seedRoom(code);
    const r1 = await handleJoinRoom(req('POST', { handle: '@bar' }), code, {
      roomStore,
    });
    const r2 = await handleJoinRoom(req('POST', { handle: '@baz' }), code, {
      roomStore,
    });
    expect(((await r1.json()) as JoinRoomResponseBody).playerId).toBe('p1');
    expect(((await r2.json()) as JoinRoomResponseBody).playerId).toBe('p2');
  });
});

describe('handleJoinRoom — input validation', () => {
  it('rejects non-POST', async () => {
    const code = VALID_CODES[0]!;
    const roomStore = await seedRoom(code);
    const res = await handleJoinRoom(req('GET', undefined), code, { roomStore });
    expect(res.status).toBe(405);
  });

  it('rejects malformed room code', async () => {
    const roomStore = await seedRoom(VALID_CODES[0]!);
    const res = await handleJoinRoom(
      req('POST', { handle: '@fufu' }),
      'BAD',
      { roomStore }
    );
    expect(res.status).toBe(400);
  });

  it('rejects malformed handle', async () => {
    const code = VALID_CODES[0]!;
    const roomStore = await seedRoom(code);
    const res = await handleJoinRoom(
      req('POST', { handle: '@a' }), // too short
      code,
      { roomStore }
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown room', async () => {
    const roomStore = createMemoryRoomStore();
    const res = await handleJoinRoom(
      req('POST', { handle: '@fufu' }),
      VALID_CODES[1]!,
      { roomStore }
    );
    expect(res.status).toBe(404);
  });
});

describe('handleJoinRoom — lifecycle conflicts', () => {
  it('returns 409 when handle is already in the room', async () => {
    const code = VALID_CODES[0]!;
    const roomStore = await seedRoom(code);
    await handleJoinRoom(req('POST', { handle: '@fufu' }), code, { roomStore });
    const res = await handleJoinRoom(req('POST', { handle: '@fufu' }), code, {
      roomStore,
    });
    expect(res.status).toBe(409);
  });

  it('returns 409 when room is full (4P → 4 members)', async () => {
    const code = VALID_CODES[0]!;
    const roomStore = await seedRoom(code);
    await handleJoinRoom(req('POST', { handle: '@user1' }), code, { roomStore });
    await handleJoinRoom(req('POST', { handle: '@user2' }), code, { roomStore });
    await handleJoinRoom(req('POST', { handle: '@user3' }), code, { roomStore });
    // The 5th joiner pushes past the 4P cap.
    const res = await handleJoinRoom(
      req('POST', { handle: '@user4' }),
      code,
      { roomStore }
    );
    expect(res.status).toBe(409);
  });
});

// ─── R-I5 regression — rate limit on /join ───────────────────────────────────

describe('handleJoinRoom — R-I5: rate limit', () => {
  it('returns 429 when limiter denies', async () => {
    const code = VALID_CODES[0]!;
    const roomStore = await seedRoom(code);
    const tightLimiter: RateLimiter = {
      check() {
        return { allowed: false, retryAfterMs: 3000 };
      },
    };
    const res = await handleJoinRoom(
      req('POST', { handle: '@fufu' }),
      code,
      {
        roomStore,
        tokenGen: counter('joiner'),
        now: () => 1_700_000_000_000,
        rateLimiter: tightLimiter,
      }
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('3');
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('rate_limited');
  });

  it('keys rate-limit by extracted identity', async () => {
    const code = VALID_CODES[0]!;
    const roomStore = await seedRoom(code);
    const calls: string[] = [];
    const limiter: RateLimiter = {
      check(key) {
        calls.push(key);
        return { allowed: true };
      },
    };
    await handleJoinRoom(req('POST', { handle: '@fufu' }), code, {
      roomStore,
      tokenGen: counter('joiner'),
      now: () => 1_700_000_000_000,
      rateLimiter: limiter,
      identify: () => '10.0.0.1',
    });
    expect(calls).toEqual(['join:10.0.0.1']);
  });
});
