// Behavior tests for handleMove. Focused on the wiring contract — auth,
// validation, idempotency, rate-limit, missing-round handling, replay tag.
// The deep game-logic correctness is covered by handleMoveCommand tests
// (tests/realtime/handleMove.test.ts).

import { describe, expect, it } from 'vitest';
import { handleMove, IDEMPOTENCY_TTL_SECONDS } from '@lib/api/move';
import {
  handleCreateRoom,
  type CreateRoomResponseBody,
} from '@lib/api/createRoom';
import { handleJoinRoom, type JoinRoomResponseBody } from '@lib/api/joinRoom';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import { createMemoryRoundStore } from '@lib/storage/roundStore';
import type { RoundEnvelope } from '@lib/storage/roundStore';
import { createMemoryIdempotencyCache } from '@lib/realtime/idempotency';
import type { IdempotencyCache, ReserveResult } from '@lib/realtime/idempotency';
import { createSlidingWindowLimiter } from '@lib/security/rateLimit';
import type { RateLimiter } from '@lib/security/rateLimit';
import type { MoveResponse } from '@lib/realtime/commands';
import { dealRound, startTrick } from '@lib/game/round';
import type { GameRound, PlayerSeat } from '@lib/game/round';
import { shuffleDeck, buildDeck } from '@lib/game/cards';
import { encodeCards } from '@lib/realtime/cardCodec';
import seedrandom from 'seedrandom';

const CODE = 'A2B3C4';

function req(opts: {
  method?: string;
  body?: unknown;
  bearer?: string;
}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  return new Request('http://test/', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

interface Fixture {
  deps: {
    roomStore: ReturnType<typeof createMemoryRoomStore>;
    roundStore: ReturnType<typeof createMemoryRoundStore>;
    idempotency: IdempotencyCache;
    rateLimiter: RateLimiter;
    now: () => number;
  };
  hostJoinToken: string;
  p1Token: string;
  p2Token: string;
  p3Token: string;
}

async function fixture(): Promise<Fixture> {
  const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
  const roundStore = createMemoryRoundStore(() => 1_700_000_000_000);
  const idempotency = createMemoryIdempotencyCache(() => 1_700_000_000_000);
  const rateLimiter = createSlidingWindowLimiter({ windowMs: 10_000, max: 30 });

  const createDeps = {
    roomStore,
    tokenGen: counter('tok'),
    codeGen: () => CODE,
    now: () => 1_700_000_000_000,
  };
  const createRes = await handleCreateRoom(
    req({ body: { mode: '4', host: { handle: '@host' } } }),
    createDeps
  );
  const create = (await createRes.json()) as CreateRoomResponseBody;

  const joinDeps = {
    roomStore,
    tokenGen: counter('jt'),
    now: () => 1_700_000_000_000,
  };
  const j1 = (await (
    await handleJoinRoom(req({ body: { handle: '@uone' } }), CODE, joinDeps)
  ).json()) as JoinRoomResponseBody;
  const j2 = (await (
    await handleJoinRoom(req({ body: { handle: '@utwo' } }), CODE, joinDeps)
  ).json()) as JoinRoomResponseBody;
  const j3 = (await (
    await handleJoinRoom(req({ body: { handle: '@uthr' } }), CODE, joinDeps)
  ).json()) as JoinRoomResponseBody;

  return {
    deps: {
      roomStore,
      roundStore,
      idempotency,
      rateLimiter,
      now: () => 1_700_000_000_000,
    },
    hostJoinToken: create.hostJoinToken,
    p1Token: j1.joinToken,
    p2Token: j2.joinToken,
    p3Token: j3.joinToken,
  };
}

function buildInitialRound(): GameRound {
  const seats: readonly PlayerSeat[] = [
    { id: 'p0', team: 't1', position: 0 },
    { id: 'p1', team: 't2', position: 1 },
    { id: 'p2', team: 't1', position: 2 },
    { id: 'p3', team: 't2', position: 3 },
  ];
  const rng = seedrandom('move-handler-test');
  const deck = buildDeck();
  const shuffled = shuffleDeck(deck, () => rng());
  const round = dealRound({
    mode: '4',
    level: '2',
    owner: null,
    seats,
    leader: 'p0',
    shuffledDeck: shuffled,
  });
  return startTrick(round);
}

describe('handleMove — auth', () => {
  it('returns 200 auth_failed when bearer is missing', async () => {
    const fx = await fixture();
    const res = await handleMove(
      req({
        body: { moveId: 'm-1', command: { kind: 'pass', fromVersion: 0 } },
      }),
      CODE,
      fx.deps
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as MoveResponse;
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error).toBe('auth_failed');
  });

  it('returns 404 when room does not exist', async () => {
    const fx = await fixture();
    const res = await handleMove(
      req({
        body: { moveId: 'm-1', command: { kind: 'pass', fromVersion: 0 } },
        bearer: fx.p1Token,
      }),
      'D5E6F7',
      fx.deps
    );
    expect(res.status).toBe(404);
  });

  it('returns auth_failed when bearer is not a member', async () => {
    const fx = await fixture();
    const res = await handleMove(
      req({
        body: { moveId: 'm-1', command: { kind: 'pass', fromVersion: 0 } },
        bearer: 'not-a-real-token',
      }),
      CODE,
      fx.deps
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as MoveResponse;
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error).toBe('auth_failed');
  });
});

describe('handleMove — method / path / body validation', () => {
  it('rejects non-POST methods', async () => {
    const fx = await fixture();
    const res = await handleMove(
      req({ method: 'GET', bearer: fx.p1Token }),
      CODE,
      fx.deps
    );
    expect(res.status).toBe(405);
  });

  it('rejects invalid room code', async () => {
    const fx = await fixture();
    const res = await handleMove(
      req({
        body: { moveId: 'm-1', command: { kind: 'pass', fromVersion: 0 } },
        bearer: fx.p1Token,
      }),
      'BAD',
      fx.deps
    );
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON body', async () => {
    const fx = await fixture();
    const r = new Request('http://test/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${fx.p1Token}`,
      },
      body: '{not-json',
    });
    const res = await handleMove(r, CODE, fx.deps);
    expect(res.status).toBe(400);
  });

  it('returns invalid_move when moveId is missing', async () => {
    const fx = await fixture();
    const res = await handleMove(
      req({
        body: { command: { kind: 'pass', fromVersion: 0 } },
        bearer: fx.p1Token,
      }),
      CODE,
      fx.deps
    );
    const body = (await res.json()) as MoveResponse;
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error).toBe('invalid_move');
  });

  it('returns invalid_move when command.fromVersion is not integer', async () => {
    const fx = await fixture();
    const res = await handleMove(
      req({
        body: { moveId: 'm-1', command: { kind: 'pass', fromVersion: 'zero' } },
        bearer: fx.p1Token,
      }),
      CODE,
      fx.deps
    );
    const body = (await res.json()) as MoveResponse;
    expect(body.ok).toBe(false);
  });

  it('returns invalid_move on unknown command kind', async () => {
    const fx = await fixture();
    const res = await handleMove(
      req({
        body: { moveId: 'm-1', command: { kind: 'sneeze', fromVersion: 0 } },
        bearer: fx.p1Token,
      }),
      CODE,
      fx.deps
    );
    const body = (await res.json()) as MoveResponse;
    expect(body.ok).toBe(false);
  });
});

describe('handleMove — missing round', () => {
  it('returns invalid_move when room exists but no active round', async () => {
    const fx = await fixture();
    const res = await handleMove(
      req({
        body: { moveId: 'm-1', command: { kind: 'pass', fromVersion: 0 } },
        bearer: fx.p1Token,
      }),
      CODE,
      fx.deps
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as MoveResponse;
    expect(body.ok).toBe(false);
    if (!body.ok) {
      expect(body.error).toBe('invalid_move');
      expect(body.details).toMatch(/no active round/i);
    }
  });

  it('commits the failure response so retries replay it', async () => {
    const fx = await fixture();
    const first = await handleMove(
      req({
        body: { moveId: 'm-1', command: { kind: 'pass', fromVersion: 0 } },
        bearer: fx.p1Token,
      }),
      CODE,
      fx.deps
    );
    const second = await handleMove(
      req({
        body: { moveId: 'm-1', command: { kind: 'pass', fromVersion: 0 } },
        bearer: fx.p1Token,
      }),
      CODE,
      fx.deps
    );
    expect((await first.json())).toEqual(await second.json());
  });
});

describe('handleMove — idempotency replay', () => {
  it('successful play, then replay returns same result tagged "replayed"', async () => {
    const fx = await fixture();
    const round = buildInitialRound();
    const initialEnvelope: RoundEnvelope = {
      round,
      version: 0,
      updatedAt: 1_700_000_000_000,
    };
    await fx.deps.roundStore.put(CODE, initialEnvelope, 86_400);

    // p0 leads the first trick — play a single card from p0's hand.
    const p0Hand = round.hands['p0']!;
    const cardId = encodeCards([p0Hand[0]!])[0]!;

    const first = await handleMove(
      req({
        body: {
          moveId: 'm-first',
          command: { kind: 'play', cards: [cardId], fromVersion: 0 },
        },
        bearer: fx.hostJoinToken,
      }),
      CODE,
      fx.deps
    );
    const firstBody = (await first.json()) as MoveResponse;
    expect(firstBody.ok).toBe(true);
    if (firstBody.ok) {
      expect(firstBody.result).toBe('applied');
      expect(firstBody.appliedVersion).toBe(1);
    }

    // Persistence: version is now 1.
    const persisted = await fx.deps.roundStore.get(CODE);
    expect(persisted?.version).toBe(1);

    // Replay same moveId.
    const replay = await handleMove(
      req({
        body: {
          moveId: 'm-first',
          command: { kind: 'play', cards: [cardId], fromVersion: 0 },
        },
        bearer: fx.hostJoinToken,
      }),
      CODE,
      fx.deps
    );
    const replayBody = (await replay.json()) as MoveResponse;
    expect(replayBody.ok).toBe(true);
    if (replayBody.ok) {
      expect(replayBody.result).toBe('replayed');
      expect(replayBody.appliedVersion).toBe(1);
    }
  });

  it('returns 409 move_in_flight when the cache reports "pending"', async () => {
    const fx = await fixture();
    const stub: IdempotencyCache = {
      async tryReserve(): Promise<ReserveResult> {
        return { status: 'pending' };
      },
      async commit() {},
    };
    const res = await handleMove(
      req({
        body: { moveId: 'm-x', command: { kind: 'pass', fromVersion: 0 } },
        bearer: fx.p1Token,
      }),
      CODE,
      { ...fx.deps, idempotency: stub }
    );
    expect(res.status).toBe(409);
  });
});

describe('handleMove — stale version', () => {
  it('returns stale_version when fromVersion does not match', async () => {
    const fx = await fixture();
    const round = buildInitialRound();
    await fx.deps.roundStore.put(
      CODE,
      { round, version: 5, updatedAt: 0 },
      86_400
    );
    const res = await handleMove(
      req({
        body: { moveId: 'm-stale', command: { kind: 'pass', fromVersion: 0 } },
        bearer: fx.hostJoinToken,
      }),
      CODE,
      fx.deps
    );
    const body = (await res.json()) as MoveResponse;
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error).toBe('stale_version');
  });
});

describe('handleMove — rate limit', () => {
  it('returns 429 with retry-after when limiter denies', async () => {
    const fx = await fixture();
    const tight: RateLimiter = {
      check() {
        return { allowed: false, retryAfterMs: 1500 };
      },
    };
    const res = await handleMove(
      req({
        body: { moveId: 'm-rl', command: { kind: 'pass', fromVersion: 0 } },
        bearer: fx.p1Token,
      }),
      CODE,
      { ...fx.deps, rateLimiter: tight }
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('2');
    const body = (await res.json()) as MoveResponse;
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.error).toBe('rate_limited');
  });
});

// Reference: IDEMPOTENCY_TTL_SECONDS is exported so consumers see the TTL
// constant. Touch it here so the import isn't tree-shaken.
expect(IDEMPOTENCY_TTL_SECONDS).toBeGreaterThan(0);
