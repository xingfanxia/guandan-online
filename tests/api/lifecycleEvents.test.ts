// Integration tests for lifecycle event emission via handleJoinRoom +
// handleLeaveRoom. Verifies room_joined / room_left flow through the
// publishEvent gateway with correct per-recipient versions.

import { describe, expect, it } from 'vitest';
import { handleCreateRoom } from '@lib/api/createRoom';
import type { CreateRoomResponseBody } from '@lib/api/createRoom';
import { handleJoinRoom } from '@lib/api/joinRoom';
import type { JoinRoomResponseBody } from '@lib/api/joinRoom';
import { handleLeaveRoom } from '@lib/api/leaveRoom';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import { createMemoryEventBus } from '@lib/realtime/eventBus';
import { createMemoryEventLog } from '@lib/realtime/eventLog';
import { eventLogKey } from '@lib/realtime/publish';

const CODE = 'A2B3C4';

function jsonReq(method: string, body: unknown, bearer?: string): Request {
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

interface Setup {
  roomStore: ReturnType<typeof createMemoryRoomStore>;
  bus: ReturnType<typeof createMemoryEventBus>;
  log: ReturnType<typeof createMemoryEventLog>;
  hostJoinToken: string;
  hostId: string;
}

async function setup(): Promise<Setup> {
  const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
  const bus = createMemoryEventBus();
  const log = createMemoryEventLog();
  const create = (await (
    await handleCreateRoom(
      jsonReq('POST', { mode: '4', host: { handle: '@host' } }),
      {
        roomStore,
        tokenGen: counter('tok'),
        codeGen: () => CODE,
        now: () => 1_700_000_000_000,
      }
    )
  ).json()) as CreateRoomResponseBody;
  return {
    roomStore,
    bus,
    log,
    hostJoinToken: create.hostJoinToken,
    hostId: create.hostId,
  };
}

describe('handleJoinRoom — lifecycle event fanout', () => {
  it('publishes room_joined at version 1 on first join (with bus + log)', async () => {
    const s = await setup();
    await handleJoinRoom(
      jsonReq('POST', { handle: '@p1user' }),
      CODE,
      {
        roomStore: s.roomStore,
        tokenGen: counter('jt'),
        now: () => 1_700_000_000_000,
        bus: s.bus,
        log: s.log,
      }
    );
    // Both the host (p0) and the new joiner (p1) should have the room_joined
    // event on their per-recipient log key — the publish gateway enumerates
    // all current members (post-join state).
    for (const pid of ['p0', 'p1']) {
      const logged = await s.log.range(eventLogKey(CODE, pid), null);
      expect(logged).toHaveLength(1);
      const event = logged[0]!.event;
      expect(event.type).toBe('room_joined');
      expect(event.version).toBe(1);
      if (event.type === 'room_joined') {
        expect(event.player.id).toBe('p1');
        // normalizeHandle strips the leading '@' for storage; UI re-adds it
        // when rendering.
        expect(event.player.handle).toBe('p1user');
        expect(event.player.team).toBe('t2');
      }
    }
  });

  it('bumps room.eventVersion monotonically across multiple joins', async () => {
    const s = await setup();
    for (let i = 1; i < 4; i++) {
      await handleJoinRoom(
        jsonReq('POST', { handle: `@p${i}xy` }),
        CODE,
        {
          roomStore: s.roomStore,
          tokenGen: counter(`jt${i}`),
          now: () => 1_700_000_000_000,
          bus: s.bus,
          log: s.log,
        }
      );
    }
    const room = await s.roomStore.get(CODE);
    expect(room?.eventVersion).toBe(3);
    // Each player's log accumulates the events that happened AFTER they
    // joined. p0 (host) sees all 3 room_joined events.
    const hostLog = await s.log.range(eventLogKey(CODE, 'p0'), null);
    expect(hostLog).toHaveLength(3);
    expect(hostLog.map((e) => e.event.version)).toEqual([1, 2, 3]);
  });

  it('omits publishEvent when bus + log are not provided (legacy callers)', async () => {
    const s = await setup();
    await handleJoinRoom(
      jsonReq('POST', { handle: '@solo' }),
      CODE,
      {
        roomStore: s.roomStore,
        tokenGen: counter('jt'),
        now: () => 1_700_000_000_000,
        // no bus / log
      }
    );
    // eventVersion still bumps (pure state change), but no event was published.
    const room = await s.roomStore.get(CODE);
    expect(room?.eventVersion).toBe(1);
    const hostLog = await s.log.range(eventLogKey(CODE, 'p0'), null);
    expect(hostLog).toHaveLength(0);
  });
});

describe('handleLeaveRoom — lifecycle event fanout', () => {
  it('publishes room_left to remaining members on leaver', async () => {
    const s = await setup();
    // Add a guest then have them leave.
    const j1 = (await (
      await handleJoinRoom(
        jsonReq('POST', { handle: '@guest1' }),
        CODE,
        {
          roomStore: s.roomStore,
          tokenGen: counter('jt'),
          now: () => 1_700_000_000_000,
          bus: s.bus,
          log: s.log,
        }
      )
    ).json()) as JoinRoomResponseBody;

    // Clear bus/log artefacts from the join phase so the leave assertion
    // doesn't double-count.
    const preLeaveCount = (await s.log.range(eventLogKey(CODE, 'p0'), null))
      .length;

    await handleLeaveRoom(
      jsonReq('POST', undefined, j1.joinToken),
      CODE,
      {
        roomStore: s.roomStore,
        now: () => 1_700_000_000_000,
        bus: s.bus,
        log: s.log,
      }
    );

    const room = await s.roomStore.get(CODE);
    expect(room?.eventVersion).toBe(2); // join was 1, leave is 2

    // Host (remaining member) receives the room_left event.
    const hostLog = await s.log.range(eventLogKey(CODE, 'p0'), null);
    expect(hostLog).toHaveLength(preLeaveCount + 1);
    const leftEvent = hostLog[hostLog.length - 1]!.event;
    expect(leftEvent.type).toBe('room_left');
    if (leftEvent.type === 'room_left') {
      expect(leftEvent.playerId).toBe('p1');
      expect(leftEvent.reason).toBe('leave');
      expect(leftEvent.version).toBe(2);
    }
  });

  it('does not publish room_left when host leaves (room is dissolved)', async () => {
    const s = await setup();
    // Add a guest so host leaving has someone to notify (but doesn't, since
    // host-leaves dissolves the room).
    await handleJoinRoom(
      jsonReq('POST', { handle: '@guest2' }),
      CODE,
      {
        roomStore: s.roomStore,
        tokenGen: counter('jt'),
        now: () => 1_700_000_000_000,
        bus: s.bus,
        log: s.log,
      }
    );
    const preHostLeaveCount = (
      await s.log.range(eventLogKey(CODE, 'p0'), null)
    ).length;

    await handleLeaveRoom(
      jsonReq('POST', undefined, s.hostJoinToken),
      CODE,
      {
        roomStore: s.roomStore,
        now: () => 1_700_000_000_000,
        bus: s.bus,
        log: s.log,
      }
    );

    // Room is gone.
    expect(await s.roomStore.get(CODE)).toBeNull();
    // No new event published — counts stayed the same.
    const hostLog = await s.log.range(eventLogKey(CODE, 'p0'), null);
    expect(hostLog).toHaveLength(preHostLeaveCount);
  });
});
