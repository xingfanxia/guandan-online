// Behavior tests for handleDcCheck — disconnect-takeover sweep endpoint.

import { describe, expect, it } from 'vitest';
import seedrandom from 'seedrandom';
import { handleDcCheck, type DcCheckResponseBody } from '@lib/api/dcCheck';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import { createMemoryRoundStore } from '@lib/storage/roundStore';
import type { RoomState, RoomMember } from '@lib/room/lifecycle';
import type { PlayerSeat } from '@lib/game/round';
import { dealRound, startTrick } from '@lib/game/round';
import { buildDeck, shuffleDeck } from '@lib/game/cards';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

const ADMIN_TOKEN = 'admin-secret-xyz';
const NOW = 1_700_000_000_000;
const THRESHOLD = 60_000;

const SEATS_4P: PlayerSeat[] = [
  { id: 'p0', team: 't1', position: 0 },
  { id: 'p1', team: 't2', position: 1 },
  { id: 'p2', team: 't1', position: 2 },
  { id: 'p3', team: 't2', position: 3 },
];

function req(opts: { method?: string; bearer?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers['authorization'] = `Bearer ${opts.bearer}`;
  return new Request('http://test/', { method: opts.method ?? 'GET', headers });
}

function member(overrides: Partial<RoomMember> & { id: string }): RoomMember {
  return {
    handle: `@${overrides.id}`,
    joinToken: `jt-${overrides.id}`,
    joinedAt: NOW,
    status: 'connected',
    ...overrides,
  };
}

function inGameRoom(
  code: string,
  members: RoomMember[],
  lastSeenAt: Record<string, number>
): RoomState {
  return {
    code,
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    hostId: members[0]!.id,
    hostToken: 'ht',
    members,
    phase: 'in_game',
    createdAt: NOW,
    lastActiveAt: NOW,
    eventVersion: 1,
    lastSeenAt,
  };
}

function lobbyRoom(code: string, members: RoomMember[]): RoomState {
  return {
    code,
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    hostId: members[0]!.id,
    hostToken: 'ht',
    members,
    phase: 'lobby',
    createdAt: NOW,
    lastActiveAt: NOW,
    eventVersion: 0,
  };
}

function freshRound() {
  const rng = seedrandom('dcCheck-1');
  const deck = shuffleDeck(buildDeck(), rng);
  return startTrick(
    dealRound({
      mode: '4',
      level: '2',
      owner: null,
      seats: SEATS_4P,
      leader: 'p0',
      shuffledDeck: deck,
    })
  );
}

// ─── auth (mirrors cleanupRooms posture) ────────────────────────────────────

describe('handleDcCheck — auth', () => {
  it('returns 503 when adminToken is not configured (fail-closed)', async () => {
    const res = await handleDcCheck(req({ bearer: 'anything' }), {
      roomStore: createMemoryRoomStore(),
      roundStore: createMemoryRoundStore(),
    });
    expect(res.status).toBe(503);
  });

  it('returns 401 when bearer is missing', async () => {
    const res = await handleDcCheck(req(), {
      roomStore: createMemoryRoomStore(),
      roundStore: createMemoryRoundStore(),
      adminToken: ADMIN_TOKEN,
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 when bearer does not match adminToken', async () => {
    const res = await handleDcCheck(req({ bearer: 'wrong' }), {
      roomStore: createMemoryRoomStore(),
      roundStore: createMemoryRoundStore(),
      adminToken: ADMIN_TOKEN,
    });
    expect(res.status).toBe(401);
  });

  it('accepts a matching bearer on an empty store', async () => {
    const res = await handleDcCheck(req({ bearer: ADMIN_TOKEN }), {
      roomStore: createMemoryRoomStore(),
      roundStore: createMemoryRoundStore(),
      adminToken: ADMIN_TOKEN,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DcCheckResponseBody;
    expect(body).toEqual({ scanned: 0, promoted: 0, errors: 0 });
  });

  it('rejects unsupported methods', async () => {
    const res = await handleDcCheck(
      req({ method: 'DELETE', bearer: ADMIN_TOKEN }),
      {
        roomStore: createMemoryRoomStore(),
        roundStore: createMemoryRoundStore(),
        adminToken: ADMIN_TOKEN,
      }
    );
    expect(res.status).toBe(405);
  });
});

// ─── getSeen hydration (integration correctness lynchpin) ───────────────────

describe('handleDcCheck — getSeen hydration', () => {
  it('does NOT take over live players whose getSeen timestamp is fresh', async () => {
    // The room has NO lastSeenAt on the hash (the production case — liveness
    // lives in the seen store, not the room). Without getSeen, every human
    // would fall back to joinedAt and be wrongly taken over. With getSeen
    // returning a fresh timestamp, all four stay human.
    const roomStore = createMemoryRoomStore();
    const roundStore = createMemoryRoundStore();
    // joined long ago so the joinedAt fallback would trip the threshold.
    const members = [member({ id: 'p0' }), member({ id: 'p1' }), member({ id: 'p2' }), member({ id: 'p3' })].map(
      (m) => ({ ...m, joinedAt: NOW - 10 * 60_000 })
    );
    const room = inGameRoom('LIVE01', members, {}); // empty lastSeenAt
    await roomStore.create(room, 86_400); // create → registers in the active index
    await roundStore.put('LIVE01', { round: freshRound(), version: 1, updatedAt: NOW }, 86_400);

    const res = await handleDcCheck(req({ bearer: ADMIN_TOKEN }), {
      roomStore,
      roundStore,
      adminToken: ADMIN_TOKEN,
      now: () => NOW,
      thresholdMs: THRESHOLD,
      getSeen: async () => NOW - 5_000, // everyone seen 5s ago — alive
    });
    const body = (await res.json()) as DcCheckResponseBody;
    expect(body.promoted).toBe(0);
    const after = await roomStore.get('LIVE01');
    expect(after?.members.every((m) => m.status === 'connected')).toBe(true);
  });

  it('takes over a player whose getSeen timestamp is stale past the threshold', async () => {
    const roomStore = createMemoryRoomStore();
    const roundStore = createMemoryRoundStore();
    const members = [member({ id: 'p0' }), member({ id: 'p1' }), member({ id: 'p2' }), member({ id: 'p3' })];
    await roomStore.create(inGameRoom('DEAD01', members, {}), 86_400);
    await roundStore.put('DEAD01', { round: freshRound(), version: 1, updatedAt: NOW }, 86_400);

    const res = await handleDcCheck(req({ bearer: ADMIN_TOKEN }), {
      roomStore,
      roundStore,
      adminToken: ADMIN_TOKEN,
      now: () => NOW,
      thresholdMs: THRESHOLD,
      // p1 went silent 90s ago; everyone else seen just now.
      getSeen: async (_code, playerId) => (playerId === 'p1' ? NOW - 90_000 : NOW - 1_000),
    });
    const body = (await res.json()) as DcCheckResponseBody;
    expect(body.promoted).toBe(1);
    const after = await roomStore.get('DEAD01');
    expect(after?.members.find((m) => m.id === 'p1')?.status).toBe('bot');
    expect(after?.members.find((m) => m.id === 'p0')?.status).toBe('connected');
  });
});

// ─── takeover behavior ──────────────────────────────────────────────────────

describe('handleDcCheck — takeover', () => {
  it('promotes a disconnected human in an in-game room to a bot', async () => {
    const roomStore = createMemoryRoomStore();
    const roundStore = createMemoryRoundStore();
    await roomStore.create(
      inGameRoom(
        'AAA111',
        [
          member({ id: 'p0' }), // live (current player); we'll keep it live
          member({ id: 'p1' }), // silent → taken over
          member({ id: 'p2' }),
          member({ id: 'p3' }),
        ],
        { p0: NOW, p1: NOW - THRESHOLD - 1, p2: NOW, p3: NOW }
      ),
      86_400
    );
    await roundStore.put(
      'AAA111',
      { round: freshRound(), version: 1, updatedAt: NOW },
      86_400
    );

    const res = await handleDcCheck(req({ bearer: ADMIN_TOKEN }), {
      roomStore,
      roundStore,
      adminToken: ADMIN_TOKEN,
      now: () => NOW,
      thresholdMs: THRESHOLD,
    });
    const body = (await res.json()) as DcCheckResponseBody;
    expect(body.scanned).toBe(1);
    expect(body.promoted).toBe(1);
    expect(body.errors).toBe(0);

    const room = await roomStore.get('AAA111');
    const m = room!.members.find((x) => x.id === 'p1')!;
    expect(m.status).toBe('bot');
    expect(m.difficulty).toBe('medium');
    expect(m.takenOverFrom).toEqual({ handle: '@p1', joinToken: 'jt-p1' });
    // The current player (p0) was live → still connected.
    expect(room!.members.find((x) => x.id === 'p0')!.status).toBe('connected');
  });

  it('advances the round via runBots when the disconnected seat is the current player', async () => {
    const roomStore = createMemoryRoomStore();
    const roundStore = createMemoryRoundStore();
    // p0 is the leader (current player) AND silent. After takeover, runBots
    // should make p0's seat (now a bot) lead the open trick, advancing the
    // currentPlayer past p0.
    await roomStore.create(
      inGameRoom(
        'BBB222',
        [
          member({ id: 'p0' }), // silent current player → taken over + plays
          member({ id: 'p1' }),
          member({ id: 'p2' }),
          member({ id: 'p3' }),
        ],
        { p0: NOW - THRESHOLD - 1, p1: NOW, p2: NOW, p3: NOW }
      ),
      86_400
    );
    const round = freshRound();
    expect(round.currentTrick?.currentPlayer).toBe('p0'); // sanity
    await roundStore.put('BBB222', { round, version: 1, updatedAt: NOW }, 86_400);

    const res = await handleDcCheck(req({ bearer: ADMIN_TOKEN }), {
      roomStore,
      roundStore,
      adminToken: ADMIN_TOKEN,
      now: () => NOW,
      thresholdMs: THRESHOLD,
      rng: seedrandom('dc-run-1'),
    });
    const body = (await res.json()) as DcCheckResponseBody;
    expect(body.promoted).toBe(1);

    const envelope = await roundStore.get('BBB222');
    // runBots applied p0's lead (bots can't pass on an open trick) → version
    // bumped past 1 and the current player moved off p0.
    expect(envelope!.version).toBeGreaterThan(1);
    expect(envelope!.round.currentTrick?.currentPlayer).not.toBe('p0');
  });

  it('does not advance the round when the disconnected seat is NOT the current player', async () => {
    const roomStore = createMemoryRoomStore();
    const roundStore = createMemoryRoundStore();
    // p1 is silent, but the current player is p0 (live). runBots must not run,
    // so the round version stays at 1.
    await roomStore.create(
      inGameRoom(
        'CCC333',
        [
          member({ id: 'p0' }),
          member({ id: 'p1' }), // silent but not current
          member({ id: 'p2' }),
          member({ id: 'p3' }),
        ],
        { p0: NOW, p1: NOW - THRESHOLD - 1, p2: NOW, p3: NOW }
      ),
      86_400
    );
    const round = freshRound();
    expect(round.currentTrick?.currentPlayer).toBe('p0');
    await roundStore.put('CCC333', { round, version: 1, updatedAt: NOW }, 86_400);

    await handleDcCheck(req({ bearer: ADMIN_TOKEN }), {
      roomStore,
      roundStore,
      adminToken: ADMIN_TOKEN,
      now: () => NOW,
      thresholdMs: THRESHOLD,
    });

    const envelope = await roundStore.get('CCC333');
    expect(envelope!.version).toBe(1); // untouched
  });

  it('leaves lobby rooms entirely untouched', async () => {
    const roomStore = createMemoryRoomStore();
    const roundStore = createMemoryRoundStore();
    // A lobby member who has been idle far past the threshold — must NOT be
    // taken over (no round to keep moving).
    await roomStore.create(
      lobbyRoom('LOB111', [
        member({ id: 'p0', joinedAt: NOW - 10 * 60 * 1000 }),
        member({ id: 'p1', joinedAt: NOW - 10 * 60 * 1000 }),
      ]),
      86_400
    );

    const res = await handleDcCheck(req({ bearer: ADMIN_TOKEN }), {
      roomStore,
      roundStore,
      adminToken: ADMIN_TOKEN,
      now: () => NOW,
      thresholdMs: THRESHOLD,
    });
    const body = (await res.json()) as DcCheckResponseBody;
    expect(body.scanned).toBe(1);
    expect(body.promoted).toBe(0);

    const room = await roomStore.get('LOB111');
    expect(room!.members.every((m) => m.status === 'connected')).toBe(true);
  });

  it('skips ghost index entries (room TTL-expired) without erroring', async () => {
    let clock = NOW;
    const roomStore = createMemoryRoomStore(() => clock);
    const roundStore = createMemoryRoundStore(() => clock);
    await roomStore.create(
      inGameRoom('GHOST1', [member({ id: 'p0' })], { p0: NOW }),
      60 // 60-second TTL
    );
    clock = NOW + 61_000; // expire the room data; index lingers

    const res = await handleDcCheck(req({ bearer: ADMIN_TOKEN }), {
      roomStore,
      roundStore,
      adminToken: ADMIN_TOKEN,
      now: () => clock,
      thresholdMs: THRESHOLD,
    });
    const body = (await res.json()) as DcCheckResponseBody;
    expect(body.scanned).toBe(1); // index still lists it
    expect(body.promoted).toBe(0); // get() → null → skipped
    expect(body.errors).toBe(0);
  });

  it('promotes multiple disconnected humans across multiple rooms', async () => {
    const roomStore = createMemoryRoomStore();
    const roundStore = createMemoryRoundStore();
    await roomStore.create(
      inGameRoom(
        'R1',
        [member({ id: 'p0' }), member({ id: 'p1' }), member({ id: 'p2' }), member({ id: 'p3' })],
        { p0: NOW, p1: NOW - THRESHOLD - 1, p2: NOW - THRESHOLD - 1, p3: NOW }
      ),
      86_400
    );
    await roomStore.create(
      inGameRoom(
        'R2',
        [member({ id: 'q0' }), member({ id: 'q1' }), member({ id: 'q2' }), member({ id: 'q3' })],
        { q0: NOW - THRESHOLD - 1, q1: NOW, q2: NOW, q3: NOW }
      ),
      86_400
    );

    const res = await handleDcCheck(req({ bearer: ADMIN_TOKEN }), {
      roomStore,
      roundStore,
      adminToken: ADMIN_TOKEN,
      now: () => NOW,
      thresholdMs: THRESHOLD,
    });
    const body = (await res.json()) as DcCheckResponseBody;
    expect(body.scanned).toBe(2);
    expect(body.promoted).toBe(3); // 2 from R1 + 1 from R2
    expect(body.errors).toBe(0);
  });

  it('takes over at an easy tier when configured', async () => {
    const roomStore = createMemoryRoomStore();
    const roundStore = createMemoryRoundStore();
    await roomStore.create(
      inGameRoom(
        'EASY01',
        [member({ id: 'p0' }), member({ id: 'p1' }), member({ id: 'p2' }), member({ id: 'p3' })],
        { p0: NOW, p1: NOW - THRESHOLD - 1, p2: NOW, p3: NOW }
      ),
      86_400
    );

    await handleDcCheck(req({ bearer: ADMIN_TOKEN }), {
      roomStore,
      roundStore,
      adminToken: ADMIN_TOKEN,
      now: () => NOW,
      thresholdMs: THRESHOLD,
      takeoverTier: 'easy',
    });

    const room = await roomStore.get('EASY01');
    expect(room!.members.find((x) => x.id === 'p1')!.difficulty).toBe('easy');
  });

  it('counts a room that throws mid-processing as an error and continues', async () => {
    const roomStore = createMemoryRoomStore();
    const roundStore = createMemoryRoundStore();
    await roomStore.create(
      inGameRoom(
        'BOOM01',
        [member({ id: 'p0' }), member({ id: 'p1' }), member({ id: 'p2' }), member({ id: 'p3' })],
        { p0: NOW, p1: NOW - THRESHOLD - 1, p2: NOW, p3: NOW }
      ),
      86_400
    );
    // Make put() throw for the takeover persist to exercise the error path.
    let calls = 0;
    roomStore.put = async () => {
      calls += 1;
      throw new Error('boom');
    };

    const res = await handleDcCheck(req({ bearer: ADMIN_TOKEN }), {
      roomStore,
      roundStore,
      adminToken: ADMIN_TOKEN,
      now: () => NOW,
      thresholdMs: THRESHOLD,
    });
    const body = (await res.json()) as DcCheckResponseBody;
    expect(calls).toBe(1);
    expect(body.errors).toBe(1);
    expect(res.status).toBe(200); // sweep still returns 200 with the count
  });
});
