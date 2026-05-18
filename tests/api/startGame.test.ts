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
