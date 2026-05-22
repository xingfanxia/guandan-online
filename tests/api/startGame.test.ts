// Behavior tests for handleStartGame.

import { describe, expect, it } from 'vitest';
import { handleStartGame } from '@lib/api/startGame';
import {
  handleCreateRoom,
  type CreateRoomResponseBody,
} from '@lib/api/createRoom';
import { handleJoinRoom, type JoinRoomResponseBody } from '@lib/api/joinRoom';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import { createMemoryRoundStore } from '@lib/storage/roundStore';
import { createMemorySessionStore } from '@lib/storage/sessionStore';
import { createMemoryEventBus } from '@lib/realtime/eventBus';
import { createMemoryEventLog } from '@lib/realtime/eventLog';
import { createMemoryIdempotencyCache } from '@lib/realtime/idempotency';
import type { IdempotencyCache } from '@lib/realtime/idempotency';
import type { MoveResponse } from '@lib/realtime/commands';
import type { RoomState } from '@lib/room/lifecycle';
import { eventLogKey } from '@lib/realtime/publish';
import seedrandom from 'seedrandom';

const CODE = 'A2B3C4';

function req(opts: { method?: string; bearer?: string }): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  return new Request('http://test/', {
    method: opts.method ?? 'POST',
    headers,
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
    sessionStore: ReturnType<typeof createMemorySessionStore>;
    bus: ReturnType<typeof createMemoryEventBus>;
    log: ReturnType<typeof createMemoryEventLog>;
    rng: () => number;
    now: () => number;
  };
  hostToken: string;
  hostJoinToken: string;
  hostId: string;
  joinTokens: string[];
}

async function fixture(seats = 4): Promise<Fixture> {
  const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
  const roundStore = createMemoryRoundStore(() => 1_700_000_000_000);
  const sessionStore = createMemorySessionStore(() => 1_700_000_000_000);
  const bus = createMemoryEventBus();
  const log = createMemoryEventLog();
  const rng = seedrandom('start-game-test') as unknown as () => number;

  const mode = seats === 4 ? '4' : seats === 6 ? '6' : '8';
  const create = (await (
    await handleCreateRoom(
      new Request('http://test/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, host: { handle: '@host' } }),
      }),
      {
        roomStore,
        tokenGen: counter('tok'),
        codeGen: () => CODE,
        now: () => 1_700_000_000_000,
      }
    )
  ).json()) as CreateRoomResponseBody;

  const joinTokens: string[] = [];
  for (let i = 1; i < seats; i++) {
    const j = (await (
      await handleJoinRoom(
        new Request('http://test/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle: `@user${i}xx` }),
        }),
        CODE,
        {
          roomStore,
          tokenGen: counter(`jt${i}`),
          now: () => 1_700_000_000_000,
        }
      )
    ).json()) as JoinRoomResponseBody;
    joinTokens.push(j.joinToken);
  }

  return {
    deps: {
      roomStore,
      roundStore,
      sessionStore,
      bus,
      log,
      rng: () => rng(),
      now: () => 1_700_000_000_000,
    },
    hostToken: create.hostToken,
    hostJoinToken: create.hostJoinToken,
    hostId: create.hostId,
    joinTokens,
  };
}

describe('handleStartGame — auth', () => {
  it('rejects missing bearer', async () => {
    const fx = await fixture();
    const res = await handleStartGame(req({}), CODE, fx.deps);
    expect(res.status).toBe(401);
  });

  it('rejects bearer matching a joinToken (not hostToken)', async () => {
    const fx = await fixture();
    // A regular member's joinToken should not authorize game start.
    const res = await handleStartGame(
      req({ bearer: fx.joinTokens[0]! }),
      CODE,
      fx.deps
    );
    expect(res.status).toBe(401);
  });

  it('rejects bearer matching the host JOIN token (still not admin)', async () => {
    const fx = await fixture();
    // hostJoinToken is SSE-reconnect for the host slot — distinct from
    // hostToken which is the admin credential.
    const res = await handleStartGame(
      req({ bearer: fx.hostJoinToken }),
      CODE,
      fx.deps
    );
    expect(res.status).toBe(401);
  });
});

describe('handleStartGame — bot-fill rooms', () => {
  /**
   * Create a 4P room with 1 host + 3 easy bots, then start it. Tests that
   * the startGame handler doesn't choke on bot members.
   */
  async function fixtureWithBots(): Promise<Fixture> {
    const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
    const roundStore = createMemoryRoundStore(() => 1_700_000_000_000);
    const sessionStore = createMemorySessionStore(() => 1_700_000_000_000);
    const bus = createMemoryEventBus();
    const log = createMemoryEventLog();
    const rng = seedrandom('bot-fill-test') as unknown as () => number;

    const create = (await (
      await handleCreateRoom(
        new Request('http://test/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: '4',
            host: { handle: '@host' },
            bots: [{ tier: 'easy' }, { tier: 'easy' }, { tier: 'easy' }],
          }),
        }),
        {
          roomStore,
          tokenGen: counter('tok'),
          codeGen: () => CODE,
          now: () => 1_700_000_000_000,
          // Deterministic bot-name picks — sequential indices into the 30-name pool.
          botNameRng: (() => {
            let i = 0;
            return () => (i++ * 1) / 30;
          })(),
        }
      )
    ).json()) as CreateRoomResponseBody;

    return {
      deps: {
        roomStore,
        roundStore,
        sessionStore,
        bus,
        log,
        rng: () => rng(),
        now: () => 1_700_000_000_000,
      },
      hostToken: create.hostToken,
      hostJoinToken: create.hostJoinToken,
      hostId: create.hostId,
      joinTokens: [],
    };
  }

  it('starts cleanly with 3 bots seated; host (seat 0) leads → bot loop is a no-op', async () => {
    const fx = await fixtureWithBots();
    const res = await handleStartGame(req({ bearer: fx.hostToken }), CODE, fx.deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: number };
    expect(body.ok).toBe(true);

    const room = await fx.deps.roomStore.get(CODE);
    expect(room?.phase).toBe('in_game');
    expect(room?.members).toHaveLength(4);
    // Host is seat 0 (connected); bots fill seats 1-3.
    expect(room?.members[0]?.status).toBe('connected');
    expect(room?.members.slice(1).every((m) => m.status === 'bot')).toBe(true);
    expect(room?.members.slice(1).every((m) => m.difficulty === 'easy')).toBe(true);

    // No bot events emitted on game-start because the host leads.
    const dealVersion = room!.eventVersion; // Stays at dealVersion (= 1 after host's room_joined skipped).
    expect(body.version).toBe(dealVersion);

    // Round is dealt and persisted with currentTrick started.
    const envelope = await fx.deps.roundStore.get(CODE);
    expect(envelope?.round.phase).toBe('playing');
    expect(envelope?.round.currentTrick).not.toBeNull();
    expect(envelope?.round.currentTrick?.currentPlayer).toBe(fx.hostId);
  });

  it('fires the bot loop when seat 0 is a bot (manually rigged room)', async () => {
    const fx = await fixtureWithBots();
    // Surgery: swap status of member[0] to bot so the leader is a bot.
    // This artificial scenario exercises the startGame bot-loop branch.
    const room = await fx.deps.roomStore.get(CODE);
    expect(room).not.toBeNull();
    const rigged = {
      ...room!,
      members: room!.members.map((m, i) =>
        i === 0 ? { ...m, status: 'bot' as const, difficulty: 'easy' as const } : m
      ),
    };
    await fx.deps.roomStore.put(rigged, 86_400);

    const res = await handleStartGame(req({ bearer: fx.hostToken }), CODE, fx.deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: number };

    // All 4 members are bots, so runBots advances through ALL of them until
    // somebody runs out of cards or the safety cap fires. Either way, version
    // should be > dealVersion (bot events emitted).
    expect(body.version).toBeGreaterThan(1);

    // Round state advanced past the deal — at least one bot played.
    const envelope = await fx.deps.roundStore.get(CODE);
    expect(envelope?.version).toBe(body.version);
    // Either the round finished or it's still playing after the safety cap.
    // Both branches prove the bot loop fired.
    expect(['playing', 'finished']).toContain(envelope?.round.phase);

    // Room eventVersion tracks the final event version.
    const finalRoom = await fx.deps.roomStore.get(CODE);
    expect(finalRoom?.eventVersion).toBe(body.version);
  });
});

describe('handleStartGame — preconditions', () => {
  it('rejects non-POST', async () => {
    const fx = await fixture();
    const res = await handleStartGame(
      req({ method: 'GET', bearer: fx.hostToken }),
      CODE,
      fx.deps
    );
    expect(res.status).toBe(405);
  });

  it('rejects malformed room code', async () => {
    const fx = await fixture();
    const res = await handleStartGame(
      req({ bearer: fx.hostToken }),
      'BAD',
      fx.deps
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown room', async () => {
    const fx = await fixture();
    const empty = {
      ...fx.deps,
      roomStore: createMemoryRoomStore(),
    };
    const res = await handleStartGame(
      req({ bearer: fx.hostToken }),
      'D5E6F7',
      empty
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when room is not full', async () => {
    // Create + only 2 members (host + 1 joiner).
    const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
    const roundStore = createMemoryRoundStore(() => 1_700_000_000_000);
    const sessionStore = createMemorySessionStore(() => 1_700_000_000_000);
    const bus = createMemoryEventBus();
    const log = createMemoryEventLog();

    const create = (await (
      await handleCreateRoom(
        new Request('http://test/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: '4', host: { handle: '@host' } }),
        }),
        {
          roomStore,
          tokenGen: counter('tok'),
          codeGen: () => CODE,
          now: () => 1_700_000_000_000,
        }
      )
    ).json()) as CreateRoomResponseBody;
    await handleJoinRoom(
      new Request('http://test/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: '@onemember' }),
      }),
      CODE,
      { roomStore, tokenGen: counter('jt'), now: () => 1_700_000_000_000 }
    );

    const res = await handleStartGame(
      req({ bearer: create.hostToken }),
      CODE,
      { roomStore, roundStore, sessionStore, bus, log, now: () => 1_700_000_000_000 }
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; details?: string };
    expect(body.details).toMatch(/needs 4 members/);
  });

  it('returns 409 when room is already in_game', async () => {
    const fx = await fixture();
    // First start succeeds.
    await handleStartGame(req({ bearer: fx.hostToken }), CODE, fx.deps);
    // Second start hits the phase guard.
    const res = await handleStartGame(req({ bearer: fx.hostToken }), CODE, fx.deps);
    expect(res.status).toBe(409);
  });
});

describe('handleStartGame — happy path (4P)', () => {
  it('persists a RoundEnvelope at room.eventVersion+1 with 27-card hands', async () => {
    const fx = await fixture();
    // After 3 joins from the fixture, room.eventVersion is 3; deal takes 4.
    const preRoom = await fx.deps.roomStore.get(CODE);
    const expectedDealVersion = (preRoom?.eventVersion ?? 0) + 1;

    const res = await handleStartGame(
      req({ bearer: fx.hostToken }),
      CODE,
      fx.deps
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; version: number };
    expect(body.version).toBe(expectedDealVersion);

    const envelope = await fx.deps.roundStore.get(CODE);
    expect(envelope).not.toBeNull();
    expect(envelope?.version).toBe(expectedDealVersion);
    expect(envelope?.round.phase).toBe('playing');
    expect(envelope?.round.currentTrick).not.toBeNull();
    for (const hand of Object.values(envelope?.round.hands ?? {})) {
      expect(hand).toHaveLength(27); // 108 cards / 4 players
    }

    // room.eventVersion advanced to match the deal version so it stays the
    // monotonic source-of-truth across lobby → game boundary.
    const postRoom = await fx.deps.roomStore.get(CODE);
    expect(postRoom?.eventVersion).toBe(expectedDealVersion);
  });

  it('transitions room.phase from lobby to in_game', async () => {
    const fx = await fixture();
    expect((await fx.deps.roomStore.get(CODE))?.phase).toBe('lobby');
    await handleStartGame(req({ bearer: fx.hostToken }), CODE, fx.deps);
    expect((await fx.deps.roomStore.get(CODE))?.phase).toBe('in_game');
  });

  it('assigns alternating teams t1/t2 across positions', async () => {
    const fx = await fixture();
    await handleStartGame(req({ bearer: fx.hostToken }), CODE, fx.deps);
    const envelope = await fx.deps.roundStore.get(CODE);
    const teams = envelope?.round.seats.map((s) => s.team) ?? [];
    expect(teams).toEqual(['t1', 't2', 't1', 't2']);
  });

  it('publishes a deal event to each per-recipient log key', async () => {
    const fx = await fixture();
    const preRoom = await fx.deps.roomStore.get(CODE);
    const expectedDealVersion = (preRoom?.eventVersion ?? 0) + 1;

    await handleStartGame(req({ bearer: fx.hostToken }), CODE, fx.deps);
    for (const playerId of ['p0', 'p1', 'p2', 'p3']) {
      const logged = await fx.deps.log.range(
        eventLogKey(CODE, playerId),
        null
      );
      expect(logged).toHaveLength(1);
      expect(logged[0]?.event.type).toBe('deal');
      expect(logged[0]?.event.version).toBe(expectedDealVersion);
    }
  });
});

describe('handleStartGame — 6P + 8P', () => {
  it('6P deals 18 cards each (108 / 6)', async () => {
    const fx = await fixture(6);
    await handleStartGame(req({ bearer: fx.hostToken }), CODE, fx.deps);
    const envelope = await fx.deps.roundStore.get(CODE);
    for (const hand of Object.values(envelope?.round.hands ?? {})) {
      expect(hand).toHaveLength(18);
    }
  });

  it('8P deals 13 each (104 dealt, 4 set aside per lib/game/cards undealtCards)', async () => {
    const fx = await fixture(8);
    await handleStartGame(req({ bearer: fx.hostToken }), CODE, fx.deps);
    const envelope = await fx.deps.roundStore.get(CODE);
    const hands = Object.values(envelope?.round.hands ?? {});
    expect(hands).toHaveLength(8);
    for (const hand of hands) expect(hand).toHaveLength(13);
    const total = hands.reduce((sum, h) => sum + h.length, 0);
    expect(total).toBe(104); // 4 cards reserved for 8P tribute pile
  });
});

// ─── R-C3 regression — concurrent start race serialized via idempotency ──────
//
// Pre-fix: two simultaneous host-token POSTs both read phase='lobby', both
// dealt independent shuffles, both wrote to roundStore (last-write wins), and
// both fanned out `deal` events at the same version with different hands —
// clients saw conflicting deals depending on which delivery they observed.
//
// Fix: a `start-${code}` reservation. The first POST wins, the second hits
// either 'pending' (returns 409) or 'done' (returns the cached deal version).
// Tests below verify both branches.

// ─── R-I5 regression — rate limit on /start ─────────────────────────────────

describe('handleStartGame — R-I5: rate limit', () => {
  it('returns 429 when limiter denies, before any state mutation', async () => {
    const fx = await fixture();
    const tightLimiter = {
      check() {
        return { allowed: false as const, retryAfterMs: 4_000 };
      },
    };
    const res = await handleStartGame(
      req({ bearer: fx.hostToken }),
      CODE,
      { ...fx.deps, rateLimiter: tightLimiter }
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('4');

    // Verify nothing was dealt (rate-limit is the gate before any mutation).
    const envelope = await fx.deps.roundStore.get(CODE);
    expect(envelope).toBeNull();
  });

  it('keys the limiter by room + identity (start:<code>:<ident>)', async () => {
    const fx = await fixture();
    const calls: string[] = [];
    const limiter = {
      check(key: string) {
        calls.push(key);
        return { allowed: true as const };
      },
    };
    await handleStartGame(
      req({ bearer: fx.hostToken }),
      CODE,
      { ...fx.deps, rateLimiter: limiter, identify: () => '7.7.7.7' }
    );
    expect(calls).toEqual([`start:${CODE}:7.7.7.7`]);
  });
});

describe('handleStartGame — R-C3: concurrent start race', () => {
  it('two simultaneous starts: exactly ONE persists; the other gets serialized rejection', async () => {
    const fx = await fixture();
    const idempotency = createMemoryIdempotencyCache(() => 1_700_000_000_000);
    const deps = { ...fx.deps, idempotency };

    // Fire both in parallel. In the in-memory cache, the first tryReserve
    // returns 'reserved' synchronously-ish; the second hits 'pending' before
    // commit lands → 409 start_in_flight. In production (Upstash) the same
    // race is resolved by Redis SET NX EX; the second POST will get either
    // 'pending' (if it lands before commit) or 'done' (cached deal). Either
    // outcome means the round is dealt exactly once.
    const [resA, resB] = await Promise.all([
      handleStartGame(req({ bearer: fx.hostToken }), CODE, deps),
      handleStartGame(req({ bearer: fx.hostToken }), CODE, deps),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = resA.status === 200 ? resA : resB;
    const winnerBody = (await winner.json()) as { ok: boolean; version: number };
    expect(winnerBody.ok).toBe(true);
    expect(winnerBody.version).toBeGreaterThan(0);

    // RoundStore has a single durable deal — version matches the winner.
    const envelope = await deps.roundStore.get(CODE);
    expect(envelope).not.toBeNull();
    expect(envelope!.version).toBe(winnerBody.version);

    // Room transitioned exactly once.
    const room = await deps.roomStore.get(CODE);
    expect(room?.phase).toBe('in_game');
  });

  it('reservation pending → second concurrent start returns 409 start_in_flight', async () => {
    const fx = await fixture();
    // Stub idempotency that always reports 'pending' — simulates the window
    // between reservation and commit, which is what an in-flight concurrent
    // POST observes.
    const stub = {
      async tryReserve() {
        return { status: 'pending' as const };
      },
      async commit() {},
    };
    const res = await handleStartGame(
      req({ bearer: fx.hostToken }),
      CODE,
      { ...fx.deps, idempotency: stub }
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('start_in_flight');
  });

  it('cache hit (status=done) returns the cached version without re-dealing', async () => {
    const fx = await fixture();
    // Pre-fill the cache with a known 'done' entry so any new attempt is a
    // cache hit. The handler should return version=42 without touching the
    // roundStore.
    const stub = {
      async tryReserve() {
        return {
          status: 'done' as const,
          result: {
            ok: true as const,
            appliedVersion: 42,
            result: 'applied' as const,
          },
        };
      },
      async commit() {},
    };
    const res = await handleStartGame(
      req({ bearer: fx.hostToken }),
      CODE,
      { ...fx.deps, idempotency: stub }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: number };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(42);

    // Critically: roundStore was NOT written to — no real deal happened.
    const envelope = await fx.deps.roundStore.get(CODE);
    expect(envelope).toBeNull();
  });
});

// ─── Round 2 CRITICAL fix — idempotency reservation orphaning on throw ──────

describe('handleStartGame — Round 2 critical: idempotency commits on downstream throw', () => {
  // Pre-fix, when sessionStore.put / roundStore.put / roomStore.put threw
  // after tryReserve, the reservation stayed in 'pending' state for
  // START_IDEMPOTENCY_TTL_SECONDS (1h). Concurrent retries got 409
  // start_in_flight for that full window — the handler was bricked for the
  // room. Post-fix, the handler catches the throw, commits an
  // 'internal_error' MoveResponse so the next retry sees a cached error
  // (status='done') instead of stuck 'pending'.

  it('returns 500 + commits error response when sessionStore.put throws', async () => {
    const fx = await fixture();
    const idempotency = createMemoryIdempotencyCache(() => 1_700_000_000_000);

    // Wrap sessionStore so its put throws but get/delete still work.
    const realSession = fx.deps.sessionStore;
    const throwingSessionStore = {
      get: realSession.get.bind(realSession),
      put: () => {
        throw new Error('simulated sessionStore.put failure');
      },
      delete: realSession.delete.bind(realSession),
    };

    // Track commits so we can assert the error was committed.
    const commits: Array<{ key: string; result: MoveResponse }> = [];
    const trackingCache: IdempotencyCache = {
      tryReserve: idempotency.tryReserve.bind(idempotency),
      async commit(key, result, ttl) {
        commits.push({ key, result });
        return idempotency.commit(key, result, ttl);
      },
    };

    const res = await handleStartGame(
      req({ bearer: fx.hostToken }),
      CODE,
      {
        ...fx.deps,
        sessionStore: throwingSessionStore,
        idempotency: trackingCache,
      }
    );

    // (a) Response is 500 with the underlying error message.
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      ok: boolean;
      error?: string;
      details?: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('internal_error');
    expect(body.details).toContain('simulated sessionStore.put failure');

    // (b) idempotency.commit was called with ok: false / internal_error.
    expect(commits).toHaveLength(1);
    expect(commits[0]!.key).toBe(`start-${CODE}`);
    expect(commits[0]!.result.ok).toBe(false);
    if (!commits[0]!.result.ok) {
      expect(commits[0]!.result.error).toBe('internal_error');
    }
  });

  it('subsequent call with same room gets cached error, NOT pending/409', async () => {
    const fx = await fixture();
    const idempotency = createMemoryIdempotencyCache(() => 1_700_000_000_000);

    // First call: roomStore.put throws → handler commits 'internal_error'.
    let shouldThrow = true;
    const realRoom = fx.deps.roomStore;
    const flakyRoomStore = {
      get: realRoom.get.bind(realRoom),
      put: (state: RoomState, ttl: number) => {
        if (shouldThrow) {
          throw new Error('first attempt fails');
        }
        return realRoom.put(state, ttl);
      },
      create: realRoom.create.bind(realRoom),
      delete: realRoom.delete.bind(realRoom),
      listCodes: realRoom.listCodes.bind(realRoom),
    };

    const first = await handleStartGame(
      req({ bearer: fx.hostToken }),
      CODE,
      { ...fx.deps, roomStore: flakyRoomStore, idempotency }
    );
    expect(first.status).toBe(500);

    // Second call — even if underlying issue is fixed, cached error must
    // replay. CRITICALLY: must NOT be 409 'start_in_flight' (which would
    // mean the reservation orphaned).
    shouldThrow = false;
    const second = await handleStartGame(
      req({ bearer: fx.hostToken }),
      CODE,
      { ...fx.deps, roomStore: flakyRoomStore, idempotency }
    );
    expect(second.status).not.toBe(409);
    const body = (await second.json()) as {
      ok: boolean;
      error?: string;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('internal_error');
  });
});
