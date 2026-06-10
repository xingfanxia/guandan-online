// Connect-snapshot tests for handleSse.
//
// REGRESSION: SnapshotEvent existed in the wire contract but no server code
// ever emitted it. Clients therefore never learned the player roster, their
// own playerId, or whose turn it was — a host playing against bots saw an
// empty table (bots never emit room_joined) and turn gating was permanently
// broken (myPlayerId null). The SSE handler now synthesizes a per-recipient
// snapshot at stream open when roundStore/sessionStore deps are provided.

import { describe, expect, it } from 'vitest';
import { handleSse, type SseDeps } from '@lib/api/sse';
import {
  handleCreateRoom,
  type CreateRoomResponseBody,
} from '@lib/api/createRoom';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import { createMemoryRoundStore } from '@lib/storage/roundStore';
import { createMemorySessionStore } from '@lib/storage/sessionStore';
import { createMemoryEventBus } from '@lib/realtime/eventBus';
import { createMemoryEventLog } from '@lib/realtime/eventLog';
import type { GameRound } from '@lib/game/round';
import type { GameSession } from '@lib/game/session';
import type { SnapshotEvent } from '@lib/realtime/messages';
import type { Card } from '@lib/game/cards';

const CODE = 'S7T8U9';
const NOW = 1_700_000_000_000;

function card(rank: Card['rank'], suit: Card['suit'], deck: 1 | 2): Card {
  return { rank, suit, deck } as Card;
}

/** Create a room with host + 3 bots, then store a literal in-flight round. */
async function fixture() {
  const roomStore = createMemoryRoomStore(() => NOW);
  const roundStore = createMemoryRoundStore(() => NOW);
  const sessionStore = createMemorySessionStore(() => NOW);
  const bus = createMemoryEventBus();
  const log = createMemoryEventLog();

  let tok = 0;
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
        tokenGen: () => `tok-${++tok}`,
        codeGen: () => CODE,
        now: () => NOW,
      }
    )
  ).json()) as CreateRoomResponseBody;

  const room = await roomStore.get(CODE);
  const ids = room!.members.map((m) => m.id);

  const round: GameRound = {
    mode: '4',
    level: '5',
    owner: 't1',
    seats: ids.map((id, i) => ({
      id,
      position: i,
      team: i % 2 === 0 ? 't1' : 't2',
    })),
    hands: {
      // NOTE: the 3♣ p1 played into the current trick is NOT in p1's hand —
      // played cards leave the hand, and the leak detector (correctly)
      // flags any payload card that still maps to an opponent's hand.
      [ids[0]!]: [card('A', 'spades', 1), card('K', 'hearts', 1)],
      [ids[1]!]: [card('6', 'clubs', 1)],
      [ids[2]!]: [card('4', 'diamonds', 1)],
      [ids[3]!]: [card('5', 'clubs', 2)],
    },
    leader: ids[0]!,
    phase: 'playing',
    finishOrder: [],
    currentTrick: {
      leader: ids[1]!,
      currentPlayer: ids[0]!,
      bestPattern: null,
      bestPlayer: ids[1]!,
      entries: [
        {
          kind: 'play',
          player: ids[1]!,
          pattern: { kind: 'single', rank: '3', length: 1, cards: [card('3', 'clubs', 1)] },
          cards: [card('3', 'clubs', 1)],
        },
      ],
      awaitingResponse: [],
    },
  };
  await roundStore.put(CODE, { round, version: 42, updatedAt: NOW }, 3600);

  const session: GameSession = {
    mode: '4',
    teamLevels: { t1: '5', t2: '3' },
    teamAFails: { t1: 1, t2: 0 },
    roundOwner: 't1',
    finishedRounds: 2,
    phase: 'playing',
    winnerTeam: null,
    rules: { strictA: true },
  } as unknown as GameSession;
  await sessionStore.put(CODE, session, 3600);

  const deps: SseDeps = {
    roomStore,
    roundStore,
    sessionStore,
    bus,
    log,
    heartbeatMs: 10_000,
    rotationMs: 200,
  };
  return { deps, hostToken: create.hostJoinToken, ids, roundStore };
}

async function drain(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

function req(token: string): Request {
  return new Request(`http://test/api/sse/${CODE}?token=${token}`, {
    method: 'GET',
  });
}

describe('handleSse — connect snapshot', () => {
  it('opens the stream with a per-recipient snapshot frame', async () => {
    const { deps, hostToken, ids } = await fixture();
    const res = await handleSse(req(hostToken), CODE, deps);
    expect(res.status).toBe(200);
    const text = await drain(res);

    const frames = text.split('\n\n').filter((f) => f.includes('event: snapshot'));
    expect(frames.length).toBe(1);
    const frame = frames[0]!;
    // Synthetic control frame — must NOT carry an id: line (Last-Event-ID
    // resume would otherwise skip the real event at the same version).
    expect(frame).not.toMatch(/(^|\n)id:/);

    const data = JSON.parse(frame.split('data: ')[1]!) as SnapshotEvent;
    expect(data.version).toBe(42);
    expect(data.you.playerId).toBe(ids[0]);
    expect(data.you.hand).toEqual(['A-S-1', 'K-H-1']);
    expect(data.players).toHaveLength(4);
    expect(data.table.currentTurn).toBe(ids[0]);
    expect(data.table.teamLevels).toEqual({ t1: '5', t2: '3' });
    // Session context for resume: 1-based round counter + A-fail counters.
    expect(data.roundNumber).toBe(3);
    expect(data.teamAFails).toEqual({ t1: 1, t2: 0 });
    // Roster carries bot status so the client can render AI seats.
    expect(data.players.filter((p) => p.status === 'bot')).toHaveLength(3);
    // Mid-trick play is included so a reloading client can rebuild the trick.
    expect(data.table.currentTrick).toEqual([
      { player: ids[1], cards: ['3-C-1'] },
    ]);
    // Privacy: no other player's card identity may appear anywhere.
    expect(text).not.toContain('"3-C-1","');
    expect(JSON.stringify(data.you.hand)).not.toContain('4-D-1');
  });

  it('omits the snapshot when no round exists (lobby phase)', async () => {
    const { deps, hostToken, roundStore } = await fixture();
    await roundStore.delete(CODE);
    const res = await handleSse(req(hostToken), CODE, deps);
    const text = await drain(res);
    expect(text).not.toContain('event: snapshot');
  });

  it('keeps the stream alive when the snapshot build throws', async () => {
    const { deps, hostToken } = await fixture();
    const throwingDeps: SseDeps = {
      ...deps,
      roundStore: {
        get: async () => {
          throw new Error('boom');
        },
        put: async () => undefined,
        delete: async () => undefined,
      },
    };
    const res = await handleSse(req(hostToken), CODE, throwingDeps);
    expect(res.status).toBe(200);
    const text = await drain(res);
    // No snapshot, but the stream still rotated cleanly (stream_closing).
    expect(text).not.toContain('event: snapshot');
    expect(text).toContain('stream_closing');
  });
});
