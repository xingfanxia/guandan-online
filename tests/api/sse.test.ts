// Behavior tests for handleSse. Uses tiny heartbeat/rotation intervals so
// tests complete in real time without fake-timer plumbing.

import { describe, expect, it } from 'vitest';
import { handleSse } from '@lib/api/sse';
import {
  handleCreateRoom,
  type CreateRoomResponseBody,
} from '@lib/api/createRoom';
import { handleJoinRoom, type JoinRoomResponseBody } from '@lib/api/joinRoom';
import { createMemoryRoomStore } from '@lib/storage/roomStore';
import { createMemoryEventBus } from '@lib/realtime/eventBus';
import { createMemoryEventLog } from '@lib/realtime/eventLog';
import { eventLogKey } from '@lib/realtime/publish';
import { parseFrame } from '@lib/realtime/sse';
import type { ServerEvent } from '@lib/realtime/messages';

const CODE = 'A2B3C4';

function getReq(opts: {
  token?: string;
  lastEventId?: string;
}): Request {
  const url = new URL(`http://test/api/sse/${CODE}`);
  if (opts.token) url.searchParams.set('token', opts.token);
  const headers: Record<string, string> = {};
  if (opts.lastEventId !== undefined) {
    headers['last-event-id'] = opts.lastEventId;
  }
  return new Request(url.toString(), { method: 'GET', headers });
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

interface Fixture {
  roomStore: ReturnType<typeof createMemoryRoomStore>;
  bus: ReturnType<typeof createMemoryEventBus>;
  log: ReturnType<typeof createMemoryEventLog>;
  hostJoinToken: string;
  p1Id: string;
  p1Token: string;
}

async function fixture(): Promise<Fixture> {
  const roomStore = createMemoryRoomStore(() => 1_700_000_000_000);
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
  const join = (await (
    await handleJoinRoom(
      new Request('http://test/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: '@uone' }),
      }),
      CODE,
      { roomStore, tokenGen: counter('jt'), now: () => 1_700_000_000_000 }
    )
  ).json()) as JoinRoomResponseBody;
  return {
    roomStore,
    bus,
    log,
    hostJoinToken: create.hostJoinToken,
    p1Id: join.playerId,
    p1Token: join.joinToken,
  };
}

const heartbeatEvent = (v: number): ServerEvent => ({
  type: 'heartbeat',
  version: v,
  serverTime: '2026-05-18T00:00:00Z',
});

/** Read all chunks from a stream until it closes, decoding to text. */
async function drain(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/** Split a captured SSE text into discrete frames separated by blank lines. */
function splitFrames(text: string): string[] {
  return text.split('\n\n').filter((f) => f.length > 0);
}

describe('handleSse — auth + validation', () => {
  it('rejects non-GET methods', async () => {
    const fx = await fixture();
    const req = new Request(`http://test/api/sse/${CODE}`, { method: 'POST' });
    const res = await handleSse(req, CODE, fx);
    expect(res.status).toBe(405);
  });

  it('rejects malformed room codes', async () => {
    const fx = await fixture();
    const req = new Request('http://test/api/sse/BAD?token=anything', {
      method: 'GET',
    });
    const res = await handleSse(req, 'BAD', fx);
    expect(res.status).toBe(400);
  });

  it('returns 401 when no token is provided', async () => {
    const fx = await fixture();
    const req = new Request(`http://test/api/sse/${CODE}`, { method: 'GET' });
    const res = await handleSse(req, CODE, fx);
    expect(res.status).toBe(401);
  });

  it('returns 404 when room does not exist', async () => {
    const fx = await fixture();
    const req = getReq({ token: fx.p1Token });
    const fakeUrl = new URL(`http://test/api/sse/D5E6F7?token=${fx.p1Token}`);
    const res = await handleSse(
      new Request(fakeUrl.toString(), { method: 'GET' }),
      'D5E6F7',
      fx
    );
    expect(res.status).toBe(404);
    expect(req.url).toContain(CODE);
  });

  it('returns 401 when token does not match any member', async () => {
    const fx = await fixture();
    const res = await handleSse(
      getReq({ token: 'not-a-real-token' }),
      CODE,
      fx
    );
    expect(res.status).toBe(401);
  });
});

describe('handleSse — backlog drain on connect', () => {
  it('replays events with id > lastEventId', async () => {
    const fx = await fixture();
    // Pre-seed the per-recipient log for p1 (the requesting player).
    const logKey = eventLogKey(CODE, fx.p1Id);
    await fx.log.append(logKey, heartbeatEvent(1));
    await fx.log.append(logKey, heartbeatEvent(2));
    await fx.log.append(logKey, heartbeatEvent(3));

    const res = await handleSse(
      getReq({ token: fx.p1Token, lastEventId: '1' }),
      CODE,
      {
        ...fx,
        heartbeatMs: 10_000, // long enough to not fire during drain
        rotationMs: 50, // close quickly so the test ends
      }
    );
    const text = await drain(res);
    const frames = splitFrames(text).filter((f) => !f.startsWith(':'));
    // Expected: backlog events with id > 1 → versions 2, 3, then rotation
    expect(frames.length).toBeGreaterThanOrEqual(2);
    const first = parseFrame(frames[0] + '\n\n');
    expect((first.data as ServerEvent).version).toBe(2);
    const second = parseFrame(frames[1] + '\n\n');
    expect((second.data as ServerEvent).version).toBe(3);
  });

  it('replays from the beginning when lastEventId is missing', async () => {
    const fx = await fixture();
    const logKey = eventLogKey(CODE, fx.p1Id);
    await fx.log.append(logKey, heartbeatEvent(1));
    await fx.log.append(logKey, heartbeatEvent(2));

    const res = await handleSse(getReq({ token: fx.p1Token }), CODE, {
      ...fx,
      heartbeatMs: 10_000,
      rotationMs: 50,
    });
    const text = await drain(res);
    const frames = splitFrames(text).filter((f) => !f.startsWith(':'));
    expect(frames.length).toBeGreaterThanOrEqual(2);
  });
});

describe('handleSse — AI-4 liveness (markSeen)', () => {
  it('calls markSeen on connect and on each heartbeat with the member id', async () => {
    const fx = await fixture();
    const seen: string[] = [];
    const res = await handleSse(getReq({ token: fx.p1Token }), CODE, {
      ...fx,
      heartbeatMs: 15, // fire at least once before rotation
      rotationMs: 70,
      markSeen: (playerId) => {
        seen.push(playerId);
      },
    });
    await drain(res);
    // connect bump + ≥1 heartbeat bump, all for the requesting player.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every((id) => id === fx.p1Id)).toBe(true);
  });

  it('works without markSeen (optional dep)', async () => {
    const fx = await fixture();
    const res = await handleSse(getReq({ token: fx.p1Token }), CODE, {
      ...fx,
      heartbeatMs: 15,
      rotationMs: 50,
    });
    // Should not throw; stream drains normally.
    const text = await drain(res);
    expect(typeof text).toBe('string');
  });
});

describe('handleSse — live fanout', () => {
  it('forwards bus publishes on the per-player channel', async () => {
    const fx = await fixture();
    const res = await handleSse(getReq({ token: fx.p1Token }), CODE, {
      ...fx,
      heartbeatMs: 10_000,
      rotationMs: 80,
    });
    // Trigger a publish AFTER the handler started (the in-memory event bus
    // is synchronous, so this delivers as long as the subscribe happened
    // before this publish — which it has, since handleSse awaited
    // bus.subscribe before returning).
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    await fx.bus.publish(`game:${CODE}:player:${fx.p1Id}`, heartbeatEvent(42));
    const text = await drain(res);
    const frames = splitFrames(text).filter((f) => !f.startsWith(':'));
    const versions = frames.map(
      (f) => (parseFrame(f + '\n\n').data as ServerEvent).version
    );
    expect(versions).toContain(42);
  });

  it('does NOT forward publishes on a different player channel', async () => {
    const fx = await fixture();
    const res = await handleSse(getReq({ token: fx.p1Token }), CODE, {
      ...fx,
      heartbeatMs: 10_000,
      rotationMs: 80,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    await fx.bus.publish(`game:${CODE}:player:p0`, heartbeatEvent(99));
    const text = await drain(res);
    const frames = splitFrames(text).filter((f) => !f.startsWith(':'));
    const versions = frames.map(
      (f) => (parseFrame(f + '\n\n').data as ServerEvent).version
    );
    expect(versions).not.toContain(99);
  });
});

describe('handleSse — rotation', () => {
  it('emits a stream_closing event and closes the stream after rotationMs', async () => {
    const fx = await fixture();
    const res = await handleSse(getReq({ token: fx.p1Token }), CODE, {
      ...fx,
      heartbeatMs: 10_000,
      rotationMs: 40,
    });
    const text = await drain(res);
    const frames = splitFrames(text).filter((f) => !f.startsWith(':'));
    expect(frames.length).toBeGreaterThan(0);
    const lastFrame = frames[frames.length - 1]!;
    const last = parseFrame(lastFrame + '\n\n');
    expect((last.data as ServerEvent).type).toBe('stream_closing');
  });
});

describe('handleSse — heartbeat', () => {
  it('emits ping comment lines on the heartbeat interval', async () => {
    const fx = await fixture();
    const res = await handleSse(getReq({ token: fx.p1Token }), CODE, {
      ...fx,
      heartbeatMs: 20,
      rotationMs: 80,
    });
    const text = await drain(res);
    expect(text).toMatch(/:\s*ping\s+\d+/);
  });
});

describe('handleSse — response headers', () => {
  it('sets the SSE content-type and disables proxy buffering', async () => {
    const fx = await fixture();
    const res = await handleSse(getReq({ token: fx.p1Token }), CODE, {
      ...fx,
      heartbeatMs: 10_000,
      rotationMs: 30,
    });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toMatch(/no-store/i);
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    // Drain so the function exits cleanly.
    await drain(res);
  });
});

// ─── R-C1 regression — Last-Event-ID resume aligns with event.version ────────
//
// Pre-fix, the memory log used an internal per-room INCR counter as the
// LoggedEvent.id, and SSE wrote `id: <event.version>` on the wire. For a
// joiner whose first delivered event had version > 1 (every non-first
// joiner; every player in a bot-fill room), the seq vs version offset meant
// `log.range(roomId, lastEventIdFromBrowser)` filtered against the wrong
// units, missing events on reconnect.
//
// After fix: LoggedEvent.id === event.version, so filtering with
// `e.id > lastEventId` correctly skips events the client has already seen.

// ─── R-I3 regression — subscribe-first + buffer flush avoids race window ────
//
// Pre-fix, the SSE handler drained the log FIRST, then subscribed. With the
// Upstash event bus that seeds its cursor at the current stream top, a
// publish landing between log.range completing and subscribe seeding was
// lost (past log.range, skipped by subscribe's >=cursor filter).
//
// Post-fix, subscribe-first stashes live events into a buffer while the
// drain runs; after replay the buffer flushes dedup'd against the replayed
// set, then live events forward directly. All events delivered exactly once.

describe('handleSse — R-I3: buffered subscribe avoids drain/subscribe race', () => {
  it('delivers all events when a live publish lands during the drain window', async () => {
    const fx = await fixture();
    const logKey = eventLogKey(CODE, fx.p1Id);
    // Seed backlog at versions 4 + 5.
    await fx.log.append(logKey, heartbeatEvent(4));
    await fx.log.append(logKey, heartbeatEvent(5));

    // Race-arming hook: instrument log.range to publish v6 to the bus
    // BEFORE returning the backlog. With the buggy "drain-first" ordering,
    // v6 would be published after log.range returns its v4/v5 list and
    // before bus.subscribe seeds its cursor — lost.
    const channel = `game:${CODE}:player:${fx.p1Id}`;
    const racingLog = {
      ...fx.log,
      async range(key: string, fromId: number | null) {
        // Simulate a publish landing mid-drain. With subscribe-first, the
        // event is buffered; with drain-first it would be lost.
        await fx.bus.publish(channel, heartbeatEvent(6));
        return fx.log.range(key, fromId);
      },
    };

    const res = await handleSse(
      getReq({ token: fx.p1Token, lastEventId: '3' }),
      CODE,
      {
        ...fx,
        log: racingLog,
        heartbeatMs: 10_000,
        rotationMs: 60,
      }
    );
    const text = await drain(res);
    const frames = splitFrames(text).filter((f) => !f.startsWith(':'));
    const parsed = frames.map(
      (f) => parseFrame(f + '\n\n').data as ServerEvent
    );
    const replayed = parsed.filter((e) => e.type !== 'stream_closing');
    const versions = replayed.map((e) => e.version).sort((a, b) => a - b);
    // All three events must be delivered exactly once.
    expect(versions).toEqual([4, 5, 6]);
  });

  it('does not double-deliver an event already in the replay set', async () => {
    // If a live publish arrives DURING the drain at a version already
    // present in the backlog (rare race where the same payload is in both
    // log + bus), the dedup must filter it out.
    const fx = await fixture();
    const logKey = eventLogKey(CODE, fx.p1Id);
    await fx.log.append(logKey, heartbeatEvent(7));

    const channel = `game:${CODE}:player:${fx.p1Id}`;
    const racingLog = {
      ...fx.log,
      async range(key: string, fromId: number | null) {
        // Publish v7 to the live bus — same version that's already in the
        // backlog. Without dedup, the client would see v7 twice.
        await fx.bus.publish(channel, heartbeatEvent(7));
        return fx.log.range(key, fromId);
      },
    };

    const res = await handleSse(
      getReq({ token: fx.p1Token }),
      CODE,
      {
        ...fx,
        log: racingLog,
        heartbeatMs: 10_000,
        rotationMs: 60,
      }
    );
    const text = await drain(res);
    const frames = splitFrames(text).filter((f) => !f.startsWith(':'));
    const parsed = frames.map(
      (f) => parseFrame(f + '\n\n').data as ServerEvent
    );
    const replayed = parsed.filter((e) => e.type !== 'stream_closing');
    const sevens = replayed.filter((e) => e.version === 7);
    expect(sevens).toHaveLength(1);
  });
});

describe('handleSse — R-C1: Last-Event-ID resume aligns with event.version', () => {
  it('replays events 4+5 when client reconnects with Last-Event-ID: 3', async () => {
    const fx = await fixture();
    const logKey = eventLogKey(CODE, fx.p1Id);
    // Seed events at versions 4 and 5 — recipient missed v1-3 entirely
    // (typical for a player whose first event was a deal that landed at
    // version > 1 because lobby lifecycle bumped the counter).
    await fx.log.append(logKey, heartbeatEvent(4));
    await fx.log.append(logKey, heartbeatEvent(5));

    const res = await handleSse(
      getReq({ token: fx.p1Token, lastEventId: '3' }),
      CODE,
      { ...fx, heartbeatMs: 10_000, rotationMs: 50 }
    );
    const text = await drain(res);
    const frames = splitFrames(text).filter((f) => !f.startsWith(':'));
    const parsed = frames.map(
      (f) => parseFrame(f + '\n\n').data as ServerEvent
    );
    // Drop the rotation-closing event the handler emits at end-of-stream.
    const replayed = parsed.filter((e) => e.type !== 'stream_closing');
    expect(replayed.map((e) => e.version)).toEqual([4, 5]);
  });

  it('replays only event 5 when client reconnects with Last-Event-ID: 4', async () => {
    const fx = await fixture();
    const logKey = eventLogKey(CODE, fx.p1Id);
    await fx.log.append(logKey, heartbeatEvent(4));
    await fx.log.append(logKey, heartbeatEvent(5));

    const res = await handleSse(
      getReq({ token: fx.p1Token, lastEventId: '4' }),
      CODE,
      { ...fx, heartbeatMs: 10_000, rotationMs: 50 }
    );
    const text = await drain(res);
    const frames = splitFrames(text).filter((f) => !f.startsWith(':'));
    const parsed = frames.map(
      (f) => parseFrame(f + '\n\n').data as ServerEvent
    );
    const replayed = parsed.filter((e) => e.type !== 'stream_closing');
    expect(replayed.map((e) => e.version)).toEqual([5]);
  });
});
