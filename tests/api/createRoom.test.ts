// Behavior tests for handleCreateRoom — pure HTTP handler exercised through
// synthetic Request objects + memory roomStore.

import { describe, expect, it } from 'vitest';
import {
  handleCreateRoom,
  ROOM_TTL_SECONDS,
  type CreateRoomResponseBody,
} from '@lib/api/createRoom';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import { createMemoryIdempotencyCache } from '@lib/realtime/idempotency';
import type { RateLimiter } from '@lib/security/rateLimit';
import type { IdempotencyCache, ReserveResult } from '@lib/realtime/idempotency';
import type { MoveResponse } from '@lib/realtime/commands';
import type { RoomState } from '@lib/room/lifecycle';

function req(method: string, body: unknown): Request {
  return new Request('http://test/api/room/create', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Deterministic generators for token/code/clock.
function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

const DEPS_OK = () => ({
  roomStore: createMemoryRoomStore(() => 1_700_000_000_000),
  tokenGen: counter('tok'),
  codeGen: counter('CODE'),
  now: () => 1_700_000_000_000,
});

describe('handleCreateRoom — happy path', () => {
  it('returns 201 with code + hostToken + hostJoinToken', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      deps
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateRoomResponseBody;
    expect(body.code).toBe('CODE-1');
    expect(body.hostId).toBe('p0');
    expect(body.hostToken).toBe('tok-1');
    expect(body.hostJoinToken).toBe('tok-2');
  });

  it('persists the room so a subsequent get returns it', async () => {
    const deps = DEPS_OK();
    await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      deps
    );
    const persisted = await deps.roomStore.get('CODE-1');
    expect(persisted).not.toBeNull();
    expect(persisted?.mode).toBe('4');
    expect(persisted?.members[0]?.handle).toBe('fufu'); // normalized
  });

  it('accepts mode 4, 6, and 8', async () => {
    for (const mode of ['4', '6', '8']) {
      const deps = DEPS_OK();
      const res = await handleCreateRoom(
        req('POST', { mode, host: { handle: '@a' + mode.repeat(3) } }),
        deps
      );
      expect(res.status).toBe(201);
    }
  });
});

describe('handleCreateRoom — rejects invalid input', () => {
  it('rejects non-POST methods', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(req('GET', undefined), deps);
    expect(res.status).toBe(405);
  });

  it('rejects invalid JSON', async () => {
    const deps = DEPS_OK();
    const r = new Request('http://test/api/room/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    const res = await handleCreateRoom(r, deps);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_json');
  });

  it('rejects an unsupported mode', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '5', host: { handle: '@fufu' } }),
      deps
    );
    expect(res.status).toBe(400);
  });

  it('rejects missing host.handle', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: {} }),
      deps
    );
    expect(res.status).toBe(400);
  });

  it('rejects too-short handle', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@a' } }),
      deps
    );
    expect(res.status).toBe(400);
  });

  it('rejects handle with non-ASCII characters', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@阿祥' } }),
      deps
    );
    expect(res.status).toBe(400);
  });
});

describe('handleCreateRoom — bot fill at create-time', () => {
  // Deterministic bot-name RNG → first index of the pool ('小李').
  const detBotRng = () => 0;

  it('seats 3 bots in 4P mode (host + 3 = 4 seats)', async () => {
    const deps = { ...DEPS_OK(), botNameRng: detBotRng };
    const res = await handleCreateRoom(
      req('POST', {
        mode: '4',
        host: { handle: '@fufu' },
        bots: [{ tier: 'easy' }, { tier: 'medium' }, { tier: 'easy' }],
      }),
      deps
    );
    expect(res.status).toBe(201);
    const persisted = await deps.roomStore.get('CODE-1');
    expect(persisted?.members).toHaveLength(4);
    // Host
    expect(persisted?.members[0]?.id).toBe('p0');
    expect(persisted?.members[0]?.status).toBe('connected');
    // Bots
    expect(persisted?.members[1]?.status).toBe('bot');
    expect(persisted?.members[1]?.difficulty).toBe('easy');
    expect(persisted?.members[2]?.status).toBe('bot');
    expect(persisted?.members[2]?.difficulty).toBe('medium');
    expect(persisted?.members[3]?.status).toBe('bot');
    expect(persisted?.members[3]?.difficulty).toBe('easy');
  });

  it('assigns bot IDs as p1, p2, ... matching joinRoom convention', async () => {
    const deps = { ...DEPS_OK(), botNameRng: detBotRng };
    await handleCreateRoom(
      req('POST', {
        mode: '6',
        host: { handle: '@fufu' },
        bots: [{ tier: 'easy' }, { tier: 'easy' }],
      }),
      deps
    );
    const persisted = await deps.roomStore.get('CODE-1');
    expect(persisted?.members.map((m) => m.id)).toEqual(['p0', 'p1', 'p2']);
  });

  it('picks unique bot handles even when RNG always hits the same pool index', async () => {
    // RNG returns 0 every time → without uniqueness guard, all bots would
    // pick the same handle '@小李'. Verify the unique-handle pick path runs.
    const deps = { ...DEPS_OK(), botNameRng: detBotRng };
    await handleCreateRoom(
      req('POST', {
        mode: '4',
        host: { handle: '@fufu' },
        bots: [{ tier: 'easy' }, { tier: 'easy' }, { tier: 'easy' }],
      }),
      deps
    );
    const persisted = await deps.roomStore.get('CODE-1');
    const handles = persisted!.members.map((m) => m.handle);
    expect(new Set(handles).size).toBe(handles.length);
  });

  it('accepts no bots field — backward compatible', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      deps
    );
    expect(res.status).toBe(201);
    const persisted = await deps.roomStore.get('CODE-1');
    expect(persisted?.members).toHaveLength(1);
  });

  it('accepts empty bots array', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' }, bots: [] }),
      deps
    );
    expect(res.status).toBe(201);
    const persisted = await deps.roomStore.get('CODE-1');
    expect(persisted?.members).toHaveLength(1);
  });

  it('rejects when bots array exceeds (seatCount - 1)', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', {
        mode: '4',
        host: { handle: '@fufu' },
        // 4P can hold 3 bots; 4 bots overflows.
        bots: [
          { tier: 'easy' },
          { tier: 'easy' },
          { tier: 'easy' },
          { tier: 'easy' },
        ],
      }),
      deps
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details?: string };
    expect(body.error).toBe('invalid_request');
    expect(body.details).toMatch(/4 seats/);
  });

  it('rejects unknown bot tier', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', {
        mode: '4',
        host: { handle: '@fufu' },
        bots: [{ tier: 'godlike' }],
      }),
      deps
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_request');
  });

  it('rejects non-array bots', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' }, bots: 'easy' }),
      deps
    );
    expect(res.status).toBe(400);
  });

  it('rejects bot entry that is not an object', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' }, bots: ['easy'] }),
      deps
    );
    expect(res.status).toBe(400);
  });

  it('persists manualTribute=true on the room rules when supplied', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', {
        mode: '4',
        host: { handle: '@fufu' },
        manualTribute: true,
      }),
      deps
    );
    expect(res.status).toBe(201);
    const persisted = await deps.roomStore.get('CODE-1');
    expect(persisted?.rules.manualTribute).toBe(true);
  });

  it('defaults manualTribute to false when omitted', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      deps
    );
    expect(res.status).toBe(201);
    const persisted = await deps.roomStore.get('CODE-1');
    expect(persisted?.rules.manualTribute).toBe(false);
  });

  it('rejects non-boolean manualTribute', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', {
        mode: '4',
        host: { handle: '@fufu' },
        manualTribute: 'yes',
      }),
      deps
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details?: string };
    expect(body.error).toBe('invalid_request');
    expect(body.details).toMatch(/manualTribute/);
  });

  // ROOM-2 (2026-05-19): all 7 boolean rule axes accepted from the wire.
  // Each axis follows the same "persists override / defaults to DEFAULT_MODE_RULES
  // / rejects non-boolean" contract. Tests below cover the 6 axes added in ROOM-2
  // (manualTribute already covered above).
  const ROOM2_AXES = [
    { key: 'strictA', defaultValue: true, override: false },
    { key: 'must1', defaultValue: true, override: false },
    { key: 'wildcardHeart', defaultValue: true, override: false },
    { key: 'lastCallDeclare', defaultValue: false, override: true },
    { key: 'steelPlate', defaultValue: true, override: false },
    { key: 'triPair', defaultValue: false, override: true },
    { key: 'straightFlushAboveBomb5', defaultValue: true, override: false },
  ] as const;

  for (const { key, defaultValue, override } of ROOM2_AXES) {
    it(`persists ${key}=${override} when supplied`, async () => {
      const deps = DEPS_OK();
      const res = await handleCreateRoom(
        req('POST', { mode: '4', host: { handle: '@fufu' }, [key]: override }),
        deps
      );
      expect(res.status).toBe(201);
      const persisted = await deps.roomStore.get('CODE-1');
      expect(persisted?.rules[key]).toBe(override);
    });

    it(`defaults ${key} to ${defaultValue} when omitted`, async () => {
      const deps = DEPS_OK();
      const res = await handleCreateRoom(
        req('POST', { mode: '4', host: { handle: '@fufu' } }),
        deps
      );
      expect(res.status).toBe(201);
      const persisted = await deps.roomStore.get('CODE-1');
      expect(persisted?.rules[key]).toBe(defaultValue);
    });

    it(`rejects non-boolean ${key}`, async () => {
      const deps = DEPS_OK();
      const res = await handleCreateRoom(
        req('POST', { mode: '4', host: { handle: '@fufu' }, [key]: 'yes' }),
        deps
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; details?: string };
      expect(body.error).toBe('invalid_request');
      expect(body.details).toMatch(new RegExp(key));
    });
  }

  it('persists multiple rule overrides in one request', async () => {
    const deps = DEPS_OK();
    const res = await handleCreateRoom(
      req('POST', {
        mode: '4',
        host: { handle: '@fufu' },
        strictA: false,
        triPair: true,
        manualTribute: true,
      }),
      deps
    );
    expect(res.status).toBe(201);
    const persisted = await deps.roomStore.get('CODE-1');
    expect(persisted?.rules.strictA).toBe(false);
    expect(persisted?.rules.triPair).toBe(true);
    expect(persisted?.rules.manualTribute).toBe(true);
    // Untouched axes retain defaults.
    expect(persisted?.rules.wildcardHeart).toBe(true);
    expect(persisted?.rules.lastCallDeclare).toBe(false);
  });
});

describe('handleCreateRoom — code collision retry', () => {
  it('retries on collision and succeeds with a different code', async () => {
    const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
    // Pre-populate "CODE-1" so the first attempt collides.
    await roomStore.create(
      // minimal valid RoomState
      {
        code: 'CODE-1',
        mode: '4',
        rules: (await import('@lib/game/mode')).DEFAULT_MODE_RULES,
        hostId: 'pX',
        hostToken: 'preset',
        members: [
          {
            id: 'pX',
            handle: 'preset',
            joinToken: 'preset-jt',
            joinedAt: 0,
            status: 'connected',
          },
        ],
        phase: 'lobby',
        createdAt: 0,
        lastActiveAt: 0,
        eventVersion: 0,
      },
      ROOM_TTL_SECONDS
    );
    const deps = {
      roomStore,
      tokenGen: counter('tok'),
      codeGen: counter('CODE'),
      now: () => 1_700_000_000_000,
    };
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      deps
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateRoomResponseBody;
    expect(body.code).toBe('CODE-2'); // first attempt was CODE-1 (collision), second was CODE-2
  });

  it('gives up after the retry cap with 503', async () => {
    const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
    // Always-collide: codeGen returns the same value, and we pre-seed it.
    const fixedCode = 'COLLIDE';
    await roomStore.create(
      {
        code: fixedCode,
        mode: '4',
        rules: (await import('@lib/game/mode')).DEFAULT_MODE_RULES,
        hostId: 'pX',
        hostToken: 'preset',
        members: [
          {
            id: 'pX',
            handle: 'preset',
            joinToken: 'preset-jt',
            joinedAt: 0,
            status: 'connected',
          },
        ],
        phase: 'lobby',
        createdAt: 0,
        lastActiveAt: 0,
        eventVersion: 0,
      },
      ROOM_TTL_SECONDS
    );
    const deps = {
      roomStore,
      tokenGen: counter('tok'),
      codeGen: () => fixedCode,
      now: () => 1_700_000_000_000,
    };
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      deps
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('code_generation_exhausted');
  });
});

// ─── R-I5 regression — rate limit + idempotency on /create ──────────────────

describe('handleCreateRoom — R-I5: rate limit + idempotency', () => {
  it('returns 429 with retry-after when limiter denies', async () => {
    const tightLimiter: RateLimiter = {
      check() {
        return { allowed: false, retryAfterMs: 1500 };
      },
    };
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      { ...DEPS_OK(), rateLimiter: tightLimiter }
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('2');
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('rate_limited');
  });

  it('passes when limiter allows', async () => {
    const openLimiter: RateLimiter = {
      check() {
        return { allowed: true };
      },
    };
    const res = await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      { ...DEPS_OK(), rateLimiter: openLimiter }
    );
    expect(res.status).toBe(201);
  });

  it('uses Idempotency-Key to dedup duplicate create attempts', async () => {
    const deps = { ...DEPS_OK(), idempotency: createMemoryIdempotencyCache(() => 1_700_000_000_000) };
    const buildReq = () =>
      new Request('http://test/api/room/create', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'dedup-key-1',
        },
        body: JSON.stringify({ mode: '4', host: { handle: '@fufu' } }),
      });
    const first = await handleCreateRoom(buildReq(), deps);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as CreateRoomResponseBody;

    // Second POST with the same key — the cache returns the previously
    // committed response. Code should match (idempotent replay).
    const second = await handleCreateRoom(buildReq(), deps);
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as CreateRoomResponseBody;
    expect(secondBody.code).toBe(firstBody.code);
    expect(secondBody.hostToken).toBe(firstBody.hostToken);
  });

  it('uses dependency-injected identify() to key the limiter', async () => {
    const calls: string[] = [];
    const limiter: RateLimiter = {
      check(key) {
        calls.push(key);
        return { allowed: true };
      },
    };
    await handleCreateRoom(
      req('POST', { mode: '4', host: { handle: '@fufu' } }),
      {
        ...DEPS_OK(),
        rateLimiter: limiter,
        identify: () => '203.0.113.42',
      }
    );
    expect(calls).toEqual(['create:203.0.113.42']);
  });
});

// ─── Round 2 CRITICAL fix — idempotency reservation orphaning on throw ──────

describe('handleCreateRoom — Round 2 critical: idempotency commits on downstream throw', () => {
  // Pre-fix, when roomStore.create threw after tryReserve, the reservation
  // stayed in 'pending' state for CREATE_IDEMPOTENCY_TTL_SECONDS (1h).
  // Concurrent retries with the same Idempotency-Key got 409 create_in_flight
  // for that full window. Post-fix, the handler catches the throw, commits an
  // 'internal_error' MoveResponse so the next retry sees a cached error
  // (status='done') instead of stuck 'pending'.

  function buildReqWithKey(key: string): Request {
    return new Request('http://test/api/room/create', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify({ mode: '4', host: { handle: '@fufu' } }),
    });
  }

  it('returns 500 + commits error response when roomStore.create throws', async () => {
    const base = DEPS_OK();
    const idempotency = createMemoryIdempotencyCache(() => 1_700_000_000_000);

    const realRoom = base.roomStore;
    const throwingRoomStore = {
      get: realRoom.get.bind(realRoom),
      put: realRoom.put.bind(realRoom),
      create: () => {
        throw new Error('simulated roomStore.create failure');
      },
      delete: realRoom.delete.bind(realRoom),
      listCodes: realRoom.listCodes.bind(realRoom),
    };

    const commits: Array<{ key: string; result: MoveResponse }> = [];
    const trackingCache: IdempotencyCache = {
      tryReserve: idempotency.tryReserve.bind(idempotency),
      async commit(key, result, ttl) {
        commits.push({ key, result });
        return idempotency.commit(key, result, ttl);
      },
    };

    const res = await handleCreateRoom(buildReqWithKey('throw-key-1'), {
      ...base,
      roomStore: throwingRoomStore,
      idempotency: trackingCache,
    });

    // (a) Response is 500 with the underlying error message.
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; details?: string };
    expect(body.error).toBe('internal_error');
    expect(body.details).toContain('simulated roomStore.create failure');

    // (b) idempotency.commit was called with ok: false / internal_error.
    expect(commits).toHaveLength(1);
    expect(commits[0]!.key).toBe('create:throw-key-1');
    expect(commits[0]!.result.ok).toBe(false);
    if (!commits[0]!.result.ok) {
      expect(commits[0]!.result.error).toBe('internal_error');
    }
  });

  it('subsequent call with same Idempotency-Key gets cached error, NOT pending/409', async () => {
    const base = DEPS_OK();
    const idempotency = createMemoryIdempotencyCache(() => 1_700_000_000_000);

    let shouldThrow = true;
    const realRoom = base.roomStore;
    const flakyRoomStore = {
      get: realRoom.get.bind(realRoom),
      put: realRoom.put.bind(realRoom),
      create: (state: RoomState, ttl: number) => {
        if (shouldThrow) {
          throw new Error('first attempt fails');
        }
        return realRoom.create(state, ttl);
      },
      delete: realRoom.delete.bind(realRoom),
      listCodes: realRoom.listCodes.bind(realRoom),
    };

    const first = await handleCreateRoom(buildReqWithKey('shared-key'), {
      ...base,
      roomStore: flakyRoomStore,
      idempotency,
    });
    expect(first.status).toBe(500);

    // Second call must NOT 409. Cached error replays as 500.
    shouldThrow = false;
    const second = await handleCreateRoom(buildReqWithKey('shared-key'), {
      ...base,
      roomStore: flakyRoomStore,
      idempotency,
    });
    expect(second.status).not.toBe(409);
    expect(second.status).toBe(500);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe('internal_error');
  });
});

// ─── Round 2 IMPORTANT-3 — cached idempotency fallthrough on missing details ──

describe('handleCreateRoom — Round 2 IMPORTANT-3: cache corruption is loud', () => {
  // Pre-fix, a 'done' cache hit with cached.ok === false AND missing details
  // silently fell through to a fresh create — duplicating the room.
  // Post-fix, treat missing-details as cache corruption: log loudly + 500.

  it('returns 500 when cache returns "done" status with missing details', async () => {
    const stubCache: IdempotencyCache = {
      async tryReserve(): Promise<ReserveResult> {
        return {
          status: 'done',
          result: {
            // No details, ok: false — pre-fix this fell through to fresh create.
            ok: false,
            error: 'invalid_move', // sentinel — but no details
          },
        };
      },
      async commit() {},
    };

    const res = await handleCreateRoom(
      new Request('http://test/api/room/create', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'corrupted',
        },
        body: JSON.stringify({ mode: '4', host: { handle: '@fufu' } }),
      }),
      { ...DEPS_OK(), idempotency: stubCache }
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; details?: string };
    expect(body.error).toBe('internal_error');
    expect(body.details).toMatch(/cache corruption/i);
  });

  it('returns 500 when cache returns "done" with details that is not valid JSON', async () => {
    const stubCache: IdempotencyCache = {
      async tryReserve(): Promise<ReserveResult> {
        return {
          status: 'done',
          result: {
            ok: false,
            error: 'invalid_move',
            details: '{not-json-at-all',
          },
        };
      },
      async commit() {},
    };

    const res = await handleCreateRoom(
      new Request('http://test/api/room/create', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'corrupted-2',
        },
        body: JSON.stringify({ mode: '4', host: { handle: '@fufu' } }),
      }),
      { ...DEPS_OK(), idempotency: stubCache }
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('internal_error');
  });

  it('error replay (cached internal_error) returns 500, NOT a fresh create', async () => {
    const stubCache: IdempotencyCache = {
      async tryReserve(): Promise<ReserveResult> {
        return {
          status: 'done',
          result: {
            ok: false,
            error: 'internal_error',
            details: 'previous attempt failed',
          },
        };
      },
      async commit() {},
    };

    const res = await handleCreateRoom(
      new Request('http://test/api/room/create', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'error-replay',
        },
        body: JSON.stringify({ mode: '4', host: { handle: '@fufu' } }),
      }),
      { ...DEPS_OK(), idempotency: stubCache }
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; details?: string };
    expect(body.error).toBe('internal_error');
    expect(body.details).toBe('previous attempt failed');
  });
});
