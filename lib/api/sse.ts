// GET /api/sse/[roomId] — Server-Sent Events stream handler.
//
// Flow (matches docs/research/realtime-sync-deep-dive.md §7.5 + §7.6):
//   1. Validate roomId; auth the requester via ?token=<joinToken> against
//      room.members. EventSource cannot send custom headers from a browser,
//      so we accept the token via query string (over HTTPS).
//   2. R-I3: Subscribe to the live bus BEFORE draining the log, buffering
//      live events while the drain runs. After replay, flush the buffered
//      events dedup'd against the replayed set.
//   3. Resume: read Last-Event-ID header (or ?lastEventId=) and drain
//      eventLog.range(roomId, lastEventId).
//   4. Live: flush buffer, then forward future subscribe events directly.
//   5. Heartbeat: emit `: ping <ts>\n\n` every heartbeatMs to keep the
//      connection alive through proxies + GFW middleboxes.
//   6. Rotation: after rotationMs, send a stream_closing event and close
//      the stream. The client EventSource will reconnect with its last
//      seen id and we restart from step 1.
//
// On client disconnect (ReadableStream.cancel), unsubscribe + clear timers.
//
// Why subscribe-then-drain (R-I3): Upstash bus.subscribe seeds its cursor at
// the current top of the stream. If a publish lands between the log.range
// call and the subscribe seeding (which happens inside the Upstash impl),
// the event is BOTH past the log.range result AND skipped by the >=cursor
// subscribe filter — a lost event. Subscribing first widens the catch
// window: any event after subscribe-seed lands in the buffer, and the
// drain+dedup at the end ensures no duplicate delivery from the overlap.

import type { EventBus } from '../realtime/eventBus.js';
import type { EventLog } from '../realtime/eventLog.js';
import { formatComment, formatEvent } from '../realtime/sse.js';
import type { ServerEvent, StreamClosingEvent } from '../realtime/messages.js';
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
  /**
   * AI-4 liveness hook. Called on connect and on every heartbeat tick with the
   * connected member's id — a server-confirmed "still alive" signal the
   * dc-check cron reads to detect disconnects. Optional; omitted in tests that
   * don't exercise DC takeover. Fire-and-forget — failures are swallowed.
   */
  markSeen?: (playerId: string) => void | Promise<void>;
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

  // R-I3: subscribe-first + buffer-and-flush. While the log drain runs,
  // live events accumulate in `liveBuffer`. After the drain replays the
  // backlog (each version recorded in `replayedVersions`), we flush the
  // buffer dedup'd against the replay set, then switch to direct controller
  // writes for any remaining future events.
  let drainComplete = false;
  const liveBuffer: ServerEvent[] = [];
  const replayedVersions = new Set<number>();

  // AI-4: fire-and-forget liveness bump. Wraps deps.markSeen so a throw or
  // rejection never disturbs the stream.
  const bumpSeen = (): void => {
    if (!deps.markSeen) return;
    try {
      void Promise.resolve(deps.markSeen(member.id)).catch(() => undefined);
    } catch {
      /* never let a liveness bump break the stream */
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      // AI-4: mark alive on connect.
      bumpSeen();
      // Subscribe FIRST. Buffer live events until the drain completes; once
      // it does, flush the buffer and continue forwarding directly.
      unsubscribe = await deps.bus.subscribe(channel, (event) => {
        if (closed) return;
        if (!drainComplete) {
          liveBuffer.push(event);
          return;
        }
        // Post-drain delivery. Dedup against the replayed set in case a live
        // event arrived just as the drain was wrapping up.
        if (replayedVersions.has(event.version)) return;
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

      // Backlog drain. Per-recipient log key — each player only re-reads
      // payloads built for them. See publish.ts for why this isolation is
      // security-critical (preventing yourHand leaks on SSE resume).
      const backlog = await deps.log.range(logKey, fromId);
      for (const entry of backlog) {
        replayedVersions.add(entry.event.version);
        controller.enqueue(encoder.encode(formatEvent(entry.event)));
        if (entry.event.version > highestVersion) {
          highestVersion = entry.event.version;
        }
      }

      // Flush the buffer accumulated during the drain, skipping anything
      // already in the replay set. Then mark drainComplete so the subscribe
      // handler stops buffering.
      for (const buffered of liveBuffer) {
        if (replayedVersions.has(buffered.version)) continue;
        try {
          controller.enqueue(encoder.encode(formatEvent(buffered)));
          if (buffered.version > highestVersion) {
            highestVersion = buffered.version;
          }
        } catch {
          /* see above */
        }
      }
      liveBuffer.length = 0;
      drainComplete = true;

      // Heartbeats. Each successful tick also bumps the player's liveness
      // timestamp (AI-4) — proof the connection is still open, since the
      // enqueue below would throw if the client had gone.
      heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(formatComment(`ping ${now()}`))
          );
          bumpSeen();
        } catch {
          /* see above */
        }
      }, heartbeatMs);

      // Rotation.
      rotationTimer = setTimeout(() => {
        if (closed) return;
        // R-I4: stream_closing is a synthetic SSE control frame, NOT a
        // durable EventLog entry — it never goes through publishEvent and is
        // not appended to the log. Emit WITHOUT an `id:` line so the browser
        // doesn't store its version as Last-Event-ID; otherwise the next
        // real event published at the same numeric value (a per-recipient
        // sequence collision) would be skipped on reconnect.
        const closingEvent: StreamClosingEvent = {
          type: 'stream_closing',
          version: highestVersion + 1,
          retryAfterMs: 100,
          reason: 'rotation',
        };
        try {
          controller.enqueue(
            encoder.encode(formatEvent(closingEvent, { includeId: false }))
          );
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
