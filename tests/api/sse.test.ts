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
