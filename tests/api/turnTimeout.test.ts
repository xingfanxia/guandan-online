// Behavior tests for handleTurnTimeouts — the stalled-human-turn sweep.
//
// The sweep is the ONLY enforcement of the wire turnDeadline: it picks a
// forced move with the easy strategy and dispatches it through the injected
// move pipeline using the stalled player's joinToken.

import { describe, expect, it } from 'vitest';
import {
  handleTurnTimeouts,
  type TurnTimeoutResponseBody,
} from '@lib/api/turnTimeout';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import { createMemoryRoundStore } from '@lib/storage/roundStore';
import type { RoomState } from '@lib/room/lifecycle';
import type { GameRound } from '@lib/game/round';
import type { Card } from '@lib/game/cards';
import type { MoveCommand } from '@lib/realtime/commands';
import { DEFAULT_MODE_RULES } from '@lib/game/mode';

const ADMIN = 'admin-secret';
const NOW = 1_700_000_000_000;
const CODE = 'T1M2R3';

function card(rank: Card['rank'], suit: Card['suit'], deck: 1 | 2): Card {
  return { rank, suit, deck } as Card;
}

function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: CODE,
    mode: '4',
    rules: DEFAULT_MODE_RULES,
    hostId: 'p0',
    hostToken: 'ht',
    members: [
      { id: 'p0', handle: '@host', joinToken: 'jt-0', joinedAt: NOW, status: 'connected' },
      { id: 'p1', handle: '@b1', joinToken: 'jt-1', joinedAt: NOW, status: 'bot' },
      { id: 'p2', handle: '@h2', joinToken: 'jt-2', joinedAt: NOW, status: 'connected' },
      { id: 'p3', handle: '@b3', joinToken: 'jt-3', joinedAt: NOW, status: 'bot' },
    ],
    phase: 'in_game',
    createdAt: NOW,
    lastActiveAt: NOW,
    eventVersion: 0,
    ...overrides,
  };
}

/** Minimal in-flight round where p0 (human) must follow a single 3♣. */
function round(currentPlayer: string): GameRound {
  return {
    mode: '4',
    level: '2',
    owner: 't1',
    seats: [
      { id: 'p0', team: 't1', position: 0 },
      { id: 'p1', team: 't2', position: 1 },
      { id: 'p2', team: 't1', position: 2 },
      { id: 'p3', team: 't2', position: 3 },
    ],
    hands: {
      p0: [card('A', 'spades', 1), card('4', 'clubs', 1)],
      p1: [card('5', 'clubs', 1)],
      p2: [card('6', 'clubs', 1)],
      p3: [card('7', 'clubs', 2)],
    },
    leader: 'p3',
    phase: 'playing',
    finishOrder: [],
    currentTrick: {
      leader: 'p3',
      currentPlayer,
      bestPattern: { kind: 'single', rank: '3', length: 1, cards: [card('3', 'clubs', 1)] },
      bestPlayer: 'p3',
      entries: [
        {
          kind: 'play',
          player: 'p3',
          pattern: { kind: 'single', rank: '3', length: 1, cards: [card('3', 'clubs', 1)] },
          cards: [card('3', 'clubs', 1)],
        },
      ],
      awaitingResponse: ['p0', 'p1', 'p2'],
    },
  };
}

interface Fixture {
  deps: Parameters<typeof handleTurnTimeouts>[1];
  dispatched: { code: string; joinToken: string; body: { moveId: string; command: MoveCommand } }[];
}

async function fixture(opts: {
  currentPlayer?: string;
  updatedAt?: number;
  phase?: RoomState['phase'];
  dispatchOk?: boolean;
} = {}): Promise<Fixture> {
  const roomStore = createMemoryRoomStore(() => NOW);
  const roundStore = createMemoryRoundStore(() => NOW);
  await roomStore.create(room(opts.phase ? { phase: opts.phase } : {}), 86_400);
  await roundStore.put(
    CODE,
    {
      round: round(opts.currentPlayer ?? 'p0'),
      version: 9,
      updatedAt: opts.updatedAt ?? NOW - 120_000, // 2 min stale by default
    },
    86_400
  );
  const dispatched: Fixture['dispatched'] = [];
  const deps: Parameters<typeof handleTurnTimeouts>[1] = {
    roomStore,
    roundStore,
    adminToken: ADMIN,
    now: () => NOW,
    // Deterministic RNG that avoids the easy strategy's 30% noise branch
    // (rng() < 0.3 → random pass/play). Without this the "forces a play"
    // assertion below flakes ~15% of runs — it failed CI run 27365765331
    // and twice locally before the cause was identified.
    rng: () => 0.99,
    dispatchMove: async (code, joinToken, body) => {
      dispatched.push({ code, joinToken, body });
      return new Response(JSON.stringify({ ok: opts.dispatchOk ?? true }), { status: 200 });
    },
  };
  return { deps, dispatched };
}

function req(bearer?: string): Request {
  const headers: Record<string, string> = {};
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  return new Request('http://test/', { method: 'GET', headers });
}

describe('handleTurnTimeouts — auth', () => {
  it('fails closed without adminToken', async () => {
    const { deps } = await fixture();
    const res = await handleTurnTimeouts(req(ADMIN), { ...deps, adminToken: '' });
    expect(res.status).toBe(503);
  });

  it('401s on a bad bearer', async () => {
    const { deps } = await fixture();
    const res = await handleTurnTimeouts(req('nope'), deps);
    expect(res.status).toBe(401);
  });
});

describe('handleTurnTimeouts — sweep', () => {
  it('forces a legal move for a stalled human via their joinToken', async () => {
    const { deps, dispatched } = await fixture();
    const res = await handleTurnTimeouts(req(ADMIN), deps);
    const body = (await res.json()) as TurnTimeoutResponseBody;
    expect(body.forced).toBe(1);
    expect(body.rejected).toBe(0);
    expect(dispatched).toHaveLength(1);
    const d = dispatched[0]!;
    expect(d.code).toBe(CODE);
    expect(d.joinToken).toBe('jt-0'); // p0's token, not the admin's
    // Deterministic moveId — overlapping cron fires replay, not double-apply.
    expect(d.body.moveId).toBe(`turn-timeout-${CODE}-9`);
    expect(d.body.command.fromVersion).toBe(9);
    // p0 holds A♠ (beats single 3) — easy strategy must beat, not pass.
    expect(d.body.command.kind).toBe('play');
  });

  it('skips turns idle for less than the threshold', async () => {
    const { deps, dispatched } = await fixture({ updatedAt: NOW - 30_000 });
    const res = await handleTurnTimeouts(req(ADMIN), deps);
    const body = (await res.json()) as TurnTimeoutResponseBody;
    expect(body.forced).toBe(0);
    expect(dispatched).toHaveLength(0);
  });

  it('skips bot turns (bots act inside move requests)', async () => {
    const { deps, dispatched } = await fixture({ currentPlayer: 'p1' });
    const res = await handleTurnTimeouts(req(ADMIN), deps);
    const body = (await res.json()) as TurnTimeoutResponseBody;
    expect(body.forced).toBe(0);
    expect(dispatched).toHaveLength(0);
  });

  it('skips lobby rooms', async () => {
    const { deps, dispatched } = await fixture({ phase: 'lobby' });
    const res = await handleTurnTimeouts(req(ADMIN), deps);
    const body = (await res.json()) as TurnTimeoutResponseBody;
    expect(body.forced).toBe(0);
    expect(dispatched).toHaveLength(0);
  });

  it('counts pipeline rejections (e.g., version_conflict race) as rejected', async () => {
    const { deps } = await fixture({ dispatchOk: false });
    const res = await handleTurnTimeouts(req(ADMIN), deps);
    const body = (await res.json()) as TurnTimeoutResponseBody;
    expect(body.forced).toBe(0);
    expect(body.rejected).toBe(1);
  });
});
