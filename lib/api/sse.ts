// GET /api/sse/[roomId] — Server-Sent Events stream handler.
//
// Flow (matches docs/research/realtime-sync-deep-dive.md §7.5 + §7.6):
//   1. Validate roomId; auth the requester via ?token=<joinToken> against
//      room.members. EventSource cannot send custom headers from a browser,
//      so we accept the token via query string (over HTTPS).
//   2. Resume: read Last-Event-ID header (or ?lastEventId=) and drain
//      eventLog.range(roomId, lastEventId) before live subscribe.
//   3. Subscribe to bus channel `game:<roomId>:player:<playerId>`. Live
//      events are written as SSE frames via formatEvent.
//   4. Heartbeat: emit `: ping <ts>\n\n` every heartbeatMs to keep the
//      connection alive through proxies + GFW middleboxes.
//   5. Rotation: after rotationMs, send a stream_closing event and close
//      the stream. The client EventSource will reconnect with its last
//      seen id and we restart from step 1.
//
// On client disconnect (ReadableStream.cancel), unsubscribe + clear timers.

import type { EventBus } from '../realtime/eventBus.js';
import type { EventLog } from '../realtime/eventLog.js';
import { formatComment, formatEvent } from '../realtime/sse.js';
import type { StreamClosingEvent } from '../realtime/messages.js';
import type { RoomStore } from '../storage/roomStore.js';
import { isValidRoomCode } from '../room/code.js';
import { eventLogKey } from '../realtime/publish.js';

export interface SseDeps {
  roomStore: RoomStore;
  bus: EventBus;
  log: EventLog;
  /** Heartbeat interval. Default 20s; tests pass much smaller values. */
  heartbeatMs?: number;
  /** Stream rotation. Default 270s (under Vercel's 300s function cap). */
  rotationMs?: number;
  now?: () => number;
}

const DEFAULT_HEARTBEAT_MS = 20_000;
const DEFAULT_ROTATION_MS = 270_000;

export async function handleSse(
  req: Request,
  roomId: string,
  deps: SseDeps
): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  if (!isValidRoomCode(roomId)) {
    return json({ error: 'invalid_room_code' }, 400);
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? bearerFromHeader(req);
  if (!token) {
    return json({ error: 'unauthorized' }, 401);
  }

  const room = await deps.roomStore.get(roomId);
  if (!room) {
    return json({ error: 'room_not_found' }, 404);
  }
  const member = room.members.find((m) => m.joinToken === token);
  if (!member) {
    return json({ error: 'unauthorized' }, 401);
  }

  // Resume cursor — Last-Event-ID is set by the browser on EventSource
  // reconnect. `?lastEventId=` is the manual / non-browser equivalent.
  const lastEventIdRaw =
    req.headers.get('last-event-id') ??
    url.searchParams.get('lastEventId') ??
    null;
  const lastEventId =
    lastEventIdRaw === null || lastEventIdRaw === ''
      ? null
      : Number.parseInt(lastEventIdRaw, 10);
  const fromId = Number.isFinite(lastEventId) ? (lastEventId as number) : null;

  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const rotationMs = deps.rotationMs ?? DEFAULT_ROTATION_MS;
  const now = deps.now ?? Date.now;
  const channel = `game:${roomId}:player:${member.id}`;

  const encoder = new TextEncoder();

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let rotationTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => Promise<void>) | null = null;
  let closed = false;
  let highestVersion = 0;

  const logKey = eventLogKey(roomId, member.id);

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      // Backlog drain. Per-recipient log key — each player only re-reads
      // payloads built for them. See publish.ts for why this isolation is
      // security-critical (preventing yourHand leaks on SSE resume).
      const backlog = await deps.log.range(logKey, fromId);
      for (const entry of backlog) {
        controller.enqueue(encoder.encode(formatEvent(entry.event)));
        if (entry.event.version > highestVersion) {
          highestVersion = entry.event.version;
        }
      }

      // Live subscribe.
      unsubscribe = await deps.bus.subscribe(channel, (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(formatEvent(event)));
          if (event.version > highestVersion) {
            highestVersion = event.version;
          }
        } catch {
          // Controller may be closed mid-write if the client just
          // disconnected; swallow so no unhandled rejections fire.
        }
      });

      // Heartbeats.
      heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(formatComment(`ping ${now()}`))
          );
        } catch {
          /* see above */
        }
      }, heartbeatMs);

      // Rotation.
      rotationTimer = setTimeout(() => {
        if (closed) return;
        const closingEvent: StreamClosingEvent = {
          type: 'stream_closing',
          version: highestVersion + 1,
          retryAfterMs: 100,
          reason: 'rotation',
        };
        try {
          controller.enqueue(encoder.encode(formatEvent(closingEvent)));
        } catch {
          /* see above */
        }
        closeAll(controller);
      }, rotationMs);
    },

    cancel: () => {
      // Client disconnected — clean up without writing further.
      closed = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (rotationTimer) clearTimeout(rotationTimer);
      if (unsubscribe) void unsubscribe();
    },
  });

  function closeAll(controller: ReadableStreamDefaultController<Uint8Array>) {
    closed = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (rotationTimer) clearTimeout(rotationTimer);
    if (unsubscribe) void unsubscribe();
    try {
      controller.close();
    } catch {
      /* already closed */
    }
  }

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store, no-transform',
      // Disable buffering on nginx / Vercel's edge proxies.
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    },
  });
}

function bearerFromHeader(req: Request): string | null {
  const auth =
    req.headers.get('authorization') || req.headers.get('Authorization');
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match ? match[1]!.trim() : null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
