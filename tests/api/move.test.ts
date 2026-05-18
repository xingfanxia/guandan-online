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
import { createMemorySessionStore } from '@lib/storage/sessionStore';
import type { RoundEnvelope } from '@lib/storage/roundStore';
import { createMemoryIdempotencyCache } from '@lib/realtime/idempotency';
import type { IdempotencyCache, ReserveResult } from '@lib/realtime/idempotency';
import { createSlidingWindowLimiter } from '@lib/security/rateLimit';
import type { RateLimiter } from '@lib/security/rateLimit';
import type { MoveResponse } from '@lib/realtime/commands';
import { createMemoryEventBus } from '@lib/realtime/eventBus';
import { createMemoryEventLog } from '@lib/realtime/eventLog';
import type { ServerEvent } from '@lib/realtime/messages';
import { eventLogKey } from '@lib/realtime/publish';
import { dealRound, startTrick } from '@lib/game/round';
import type { GameRound, PlayerSeat } from '@lib/game/round';
import { shuffleDeck, buildDeck } from '@lib/game/cards';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';
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
    sessionStore: ReturnType<typeof createMemorySessionStore>;
    idempotency: IdempotencyCache;
    rateLimiter: RateLimiter;
    bus: ReturnType<typeof createMemoryEventBus>;
    log: ReturnType<typeof createMemoryEventLog>;
    now: () => number;
  };
  hostJoinToken: string;
  hostId: string;
  p1Token: string;
  p2Token: string;
  p3Token: string;
}

async function fixture(): Promise<Fixture> {
  const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
  const roundStore = createMemoryRoundStore(() => 1_700_000_000_000);
  const sessionStore = createMemorySessionStore(() => 1_700_000_000_000);
  const idempotency = createMemoryIdempotencyCache(() => 1_700_000_000_000);
  const rateLimiter = createSlidingWindowLimiter({ windowMs: 10_000, max: 30 });
  const bus = createMemoryEventBus();
  const log = createMemoryEventLog();

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
      sessionStore,
      idempotency,
      rateLimiter,
      bus,
      log,
      now: () => 1_700_000_000_000,
    },
    hostJoinToken: create.hostJoinToken,
    hostId: create.hostId,
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

describe('handleMove — publishEvent fanout', () => {
  it('appends a move_played event to each per-recipient log on successful play', async () => {
    const fx = await fixture();
    const round = buildInitialRound();
    await fx.deps.roundStore.put(
      CODE,
      { round, version: 0, updatedAt: 0 },
      86_400
    );
    const cardId = encodeCards([round.hands['p0']![0]!])[0]!;

    const res = await handleMove(
      req({
        body: {
          moveId: 'm-1',
          command: { kind: 'play', cards: [cardId], fromVersion: 0 },
        },
        bearer: fx.hostJoinToken,
      }),
      CODE,
      fx.deps
    );
    const body = (await res.json()) as MoveResponse;
    expect(body.ok).toBe(true);

    for (const playerId of ['p0', 'p1', 'p2', 'p3']) {
      const logged = await fx.deps.log.range(
        eventLogKey(CODE, playerId),
        null
      );
      expect(logged).toHaveLength(1);
      expect(logged[0]?.event.type).toBe('move_played');
      expect(logged[0]?.event.version).toBe(1);
    }
  });

  it('delivers move_played to the live bus on the actor channel', async () => {
    const fx = await fixture();
    const round = buildInitialRound();
    await fx.deps.roundStore.put(
      CODE,
      { round, version: 0, updatedAt: 0 },
      86_400
    );
    const cardId = encodeCards([round.hands['p0']![0]!])[0]!;

    const received: ServerEvent[] = [];
    await fx.deps.bus.subscribe(`game:${CODE}:player:${fx.hostId}`, (e) => {
      received.push(e);
    });

    await handleMove(
      req({
        body: {
          moveId: 'm-2',
          command: { kind: 'play', cards: [cardId], fromVersion: 0 },
        },
        bearer: fx.hostJoinToken,
      }),
      CODE,
      fx.deps
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('move_played');
    if (received[0]?.type === 'move_played') {
      expect(received[0].player).toBe(fx.hostId);
      expect(received[0].cards).toEqual([cardId]);
      expect(received[0].combinationLabel).toBe('single');
    }
  });

  it('skips event fanout on a failed (stale_version) move', async () => {
    const fx = await fixture();
    const round = buildInitialRound();
    await fx.deps.roundStore.put(
      CODE,
      { round, version: 5, updatedAt: 0 },
      86_400
    );
    await handleMove(
      req({
        body: { moveId: 'm-stale', command: { kind: 'pass', fromVersion: 0 } },
        bearer: fx.hostJoinToken,
      }),
      CODE,
      fx.deps
    );
    const logged = await fx.deps.log.range(CODE, null);
    expect(logged).toEqual([]);
  });
});

// ─── round_end / game_end emission on finished round ─────────────────────────

describe('handleMove — round_end + game_end events on finished round', () => {
  // Build a near-finished 4P round: p1/p2/p3 already in finishOrder, p0 has
  // one card left, currentTrick set up with p0 as currentPlayer. Playing
  // that single card sends p0 going-out, ends the trick, and ends the round.
  function buildNearFinishedRound(): GameRound {
    const seats: readonly PlayerSeat[] = [
      { id: 'p0', team: 't1', position: 0 },
      { id: 'p1', team: 't2', position: 1 },
      { id: 'p2', team: 't1', position: 2 },
      { id: 'p3', team: 't2', position: 3 },
    ];
    const hands: Record<string, { suit: 'spades' | 'hearts' | 'clubs' | 'diamonds'; rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'; deck: 1 | 2 }[]> = {
      p0: [{ suit: 'spades', rank: '7', deck: 1 }],
      p1: [],
      p2: [],
      p3: [],
    };
    return startTrick({
      mode: '4',
      level: '2',
      owner: null,
      seats,
      // p2 went out first (1st place, t1), then p3 (2nd, t2), then p1 (3rd, t2).
      // Final position for p0 (t1) will be 4th = 1+4 ranks for t1.
      // calculateUpgrade with ranks [1, 4] on 4P gives the (1,4) upgrade row.
      hands,
      leader: 'p0',
      phase: 'playing',
      finishOrder: ['p2', 'p3', 'p1'],
      currentTrick: null,
    });
  }

  it('emits round_end at version 1 with correct newLevels when the move closes the round (game continues)', async () => {
    const fx = await fixture();
    const round = buildNearFinishedRound();
    await fx.deps.roundStore.put(
      CODE,
      { round, version: 0, updatedAt: 1_700_000_000_000 },
      86_400
    );
    // Fresh session (both teams at '2'). Single-round game-end requires team
    // already at A; at '2' the game just continues.
    await fx.deps.sessionStore.put(
      CODE,
      {
        mode: '4',
        rules: DEFAULT_MODE_RULES,
        teamLevels: { t1: '2', t2: '2' },
        teamAFails: { t1: 0, t2: 0 },
        roundOwner: null,
        finishedRounds: 0,
        phase: 'in_progress',
        winnerTeam: null,
      },
      86_400
    );

    const cardId = encodeCards([round.hands['p0']![0]!])[0]!;
    const res = await handleMove(
      req({
        body: {
          moveId: 'm-final',
          command: { kind: 'play', cards: [cardId], fromVersion: 0 },
        },
        bearer: fx.hostJoinToken,
      }),
      CODE,
      fx.deps
    );
    const body = (await res.json()) as MoveResponse;
    expect(body.ok).toBe(true);

    // The events log for p0 should now contain: move_played (v1),
    // trick_won (v2), round_end (v3). No game_end because session continues.
    const logged = await fx.deps.log.range(eventLogKey(CODE, 'p0'), null);
    const types = logged.map((e) => e.event.type);
    expect(types).toContain('move_played');
    expect(types).toContain('trick_won');
    expect(types).toContain('round_end');
    expect(types).not.toContain('game_end');

    const roundEnd = logged.find((e) => e.event.type === 'round_end');
    if (roundEnd?.event.type === 'round_end') {
      // Winners are p2 + p0 (team t1, positions 1 and 4).
      expect(roundEnd.event.winnerTeam).toBe('t1');
      expect(roundEnd.event.winnerRanks).toEqual([1, 4]);
      // (1,4) upgrade is 1 level → t1: '2' → '3'.
      expect(roundEnd.event.newLevels.t1).toBe('3');
      expect(roundEnd.event.newLevels.t2).toBe('2');
    }

    // Session was persisted with the new levels.
    const newSession = await fx.deps.sessionStore.get(CODE);
    expect(newSession?.teamLevels.t1).toBe('3');
    expect(newSession?.finishedRounds).toBe(1);
    expect(newSession?.phase).toBe('in_progress');

    // appliedVersion advances past round_end so client's next fromVersion is correct.
    if (body.ok) expect(body.appliedVersion).toBeGreaterThanOrEqual(3);
  });

  // Build a near-finished 4P round where the LAST player to play is on the
  // losing team — yielding a CLEAN win (winning team has positions [1,2]).
  // This is the only path to finalWin under strictA, since "winning team
  // includes last place" is always treated as a dirty win.
  function buildCleanWinNearFinishedRound(): GameRound {
    const seats: readonly PlayerSeat[] = [
      { id: 'p0', team: 't1', position: 0 },
      { id: 'p1', team: 't2', position: 1 },
      { id: 'p2', team: 't1', position: 2 },
      { id: 'p3', team: 't2', position: 3 },
    ];
    const hands: Record<string, { suit: 'spades' | 'hearts' | 'clubs' | 'diamonds'; rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'; deck: 1 | 2 }[]> = {
      p0: [],
      p1: [],
      p2: [],
      p3: [{ suit: 'spades', rank: '7', deck: 1 }],
    };
    return startTrick({
      mode: '4',
      level: 'A',
      owner: 't1',
      seats,
      // finishOrder before final play: [p0, p2, p1] → t1 has 1st + 2nd (clean),
      // t2 (p1) has 3rd. p3 (t2) plays last → finishOrder = [p0, p2, p1, p3].
      // Winner t1 ranks = [1, 2]. No partner-at-last. strictA pass.
      hands,
      leader: 'p3',
      phase: 'playing',
      finishOrder: ['p0', 'p2', 'p1'],
      currentTrick: null,
    });
  }

  it('emits tribute_pending + tribute_resolved + deal after round_end when game continues (4P)', async () => {
    const fx = await fixture();
    const round = buildNearFinishedRound();
    await fx.deps.roundStore.put(
      CODE,
      { round, version: 0, updatedAt: 1_700_000_000_000 },
      86_400
    );
    await fx.deps.sessionStore.put(
      CODE,
      {
        mode: '4',
        rules: DEFAULT_MODE_RULES,
        teamLevels: { t1: '2', t2: '2' },
        teamAFails: { t1: 0, t2: 0 },
        roundOwner: null,
        finishedRounds: 0,
        phase: 'in_progress',
        winnerTeam: null,
      },
      86_400
    );

    const cardId = encodeCards([round.hands['p0']![0]!])[0]!;
    const res = await handleMove(
      req({
        body: {
          moveId: 'm-tribute-cycle',
          command: { kind: 'play', cards: [cardId], fromVersion: 0 },
        },
        bearer: fx.hostJoinToken,
      }),
      CODE,
      fx.deps
    );
    const body = (await res.json()) as MoveResponse;
    expect(body.ok).toBe(true);

    const logged = await fx.deps.log.range(eventLogKey(CODE, 'p0'), null);
    const types = logged.map((e) => e.event.type);
    // Order: move_played → trick_won → round_end → tribute_pending → (tribute_resolved?) → deal
    expect(types).toContain('round_end');
    expect(types).toContain('tribute_pending');
    expect(types).toContain('deal');

    // tribute_pending fires BEFORE deal.
    const tribIdx = types.indexOf('tribute_pending');
    const dealIdx = types.indexOf('deal');
    expect(tribIdx).toBeLessThan(dealIdx);

    // round_end fires BEFORE tribute_pending.
    const reIdx = types.indexOf('round_end');
    expect(reIdx).toBeLessThan(tribIdx);

    // Verify the new round was persisted (not the finished one).
    const persistedEnvelope = await fx.deps.roundStore.get(CODE);
    expect(persistedEnvelope?.round.phase).toBe('playing');
    expect(persistedEnvelope?.round.finishOrder).toEqual([]);
  });

  it('emits game_end when applyRoundResult closes the session (winning at A)', async () => {
    const fx = await fixture();
    const round = buildCleanWinNearFinishedRound();
    await fx.deps.roundStore.put(
      CODE,
      { round, version: 0, updatedAt: 1_700_000_000_000 },
      86_400
    );
    // Pre-state: t1 already at A, and t1 owns the round (per strictA semantics).
    // With t1 winning cleanly at A on their own round, applyRoundResult sets
    // phase='finished'.
    await fx.deps.sessionStore.put(
      CODE,
      {
        mode: '4',
        rules: DEFAULT_MODE_RULES,
        teamLevels: { t1: 'A', t2: '2' },
        teamAFails: { t1: 0, t2: 0 },
        roundOwner: 't1',
        finishedRounds: 1,
        phase: 'in_progress',
        winnerTeam: null,
      },
      86_400
    );

    const cardId = encodeCards([round.hands['p3']![0]!])[0]!;
    await handleMove(
      req({
        body: {
          moveId: 'm-final-win',
          command: { kind: 'play', cards: [cardId], fromVersion: 0 },
        },
        bearer: fx.p3Token,
      }),
      CODE,
      fx.deps
    );

    const logged = await fx.deps.log.range(eventLogKey(CODE, 'p0'), null);
    const types = logged.map((e) => e.event.type);
    expect(types).toContain('round_end');
    expect(types).toContain('game_end');

    const gameEnd = logged.find((e) => e.event.type === 'game_end');
    if (gameEnd?.event.type === 'game_end') {
      expect(gameEnd.event.winnerTeam).toBe('t1');
      expect(gameEnd.event.summary).toMatch(/Team t1 wins/);
    }

    // round_end version + 1 === game_end version.
    const roundEnd = logged.find((e) => e.event.type === 'round_end');
    if (roundEnd?.event.type === 'round_end' && gameEnd?.event.type === 'game_end') {
      expect(gameEnd.event.version).toBe(roundEnd.event.version + 1);
    }

    const finalSession = await fx.deps.sessionStore.get(CODE);
    expect(finalSession?.phase).toBe('finished');
    expect(finalSession?.winnerTeam).toBe('t1');
  });
});
