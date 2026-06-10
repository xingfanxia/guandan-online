// Event log — append-only per-room store with range read for SSE resume.
//
// SYNC: docs/research/realtime-sync-deep-dive.md § 7.5 (Last-Event-ID
// semantics). Production uses Upstash Redis Streams (XADD with auto-id,
// XRANGE for replay, XADD ... MAXLEN ~ N for bounded retention). This
// in-memory impl matches the contract for dev + tests.
//
// Resume protocol:
//   1. Client SSE drops mid-game with last-received event id = K.
//   2. Client reconnects, sends `Last-Event-ID: K` header.
//   3. Server calls eventLog.range(roomId, K) → replays events K+1, K+2, ...
//   4. If the log no longer contains the missing range (trimmed past), the
//      server emits a state_resync event instead of partial replay.
//
// LoggedEvent.id IS the event.version (R-C1 fix). SSE writes
// `id: <event.version>` on the wire, so the client's Last-Event-ID on resume
// is an event.version — the log range filter MUST be in the same units.
// Storing an independent per-room internal seq was a bug: when a joiner's
// first delivered event has version > 1 (every non-first joiner; every player
// in a bot-fill room), the seq vs version offset caused the wrong range to be
// selected on reconnect.

import type { ServerEvent } from './messages.js';
import { decodeStreamValue, type RedisLike } from './redisClient.js';

export interface LoggedEvent {
  /** Equal to event.version. Kept as a separate field for legacy callers
   * and for symmetry with the Upstash stream id, which encodes the version. */
  id: number;
  event: ServerEvent;
}

export interface EventLog {
  /** Append an event; returns the assigned id (== event.version). */
  append(roomId: string, event: ServerEvent): Promise<number>;
  /**
   * Read events with id > fromId. Pass null for fromId to read all.
   * Returns chronological order (oldest first).
   */
  range(roomId: string, fromId: number | null): Promise<LoggedEvent[]>;
}

export interface EventLogOptions {
  /** If set, each room keeps only the most recent N events (older are dropped). */
  maxPerRoom?: number;
}

interface RoomLog {
  events: LoggedEvent[];
}

export function createMemoryEventLog(options: EventLogOptions = {}): EventLog {
  const rooms = new Map<string, RoomLog>();
  const maxPerRoom = options.maxPerRoom;

  function getRoom(roomId: string): RoomLog {
    let room = rooms.get(roomId);
    if (!room) {
      room = { events: [] };
      rooms.set(roomId, room);
    }
    return room;
  }

  return {
    append(roomId, event) {
      const room = getRoom(roomId);
      // R-C1: id is the event.version, not an independent seq.
      const id = event.version;
      room.events.push({ id, event });
      if (maxPerRoom !== undefined && room.events.length > maxPerRoom) {
        room.events.splice(0, room.events.length - maxPerRoom);
      }
      return Promise.resolve(id);
    },

    range(roomId, fromId) {
      const room = rooms.get(roomId);
      if (!room) return Promise.resolve([]);
      const lower = fromId ?? 0;
      return Promise.resolve(room.events.filter((e) => e.id > lower));
    },
  };
}

// ─── Upstash Redis implementation ─────────────────────────────────────────────
//
// Backing model:
//   - `events:<room>` Redis Stream — one entry per event
//
// Stream entries are written with explicit ids of the form `<event.version>-0`
// (R-C1 fix). The event payload is JSON-encoded into a single `data` field —
// keeps schema evolution under JSON's belt, not Redis's. The id mirrors the
// event.version so that SSE Last-Event-ID resume (which carries the version)
// can be translated directly into a `(<version>-0` exclusive XRANGE bound.
//
// Note: a previous incarnation used an independent INCR counter and stream id
// pair. That meant the LoggedEvent.id was an internal seq, NOT the event
// version, and SSE resume could replay the wrong slice for any recipient
// whose first delivered event had version > 1 (every non-first joiner).
//
// TTL: refreshed on every append. Default 24h matches the room lifecycle. A
// reconnecting client that lapses beyond TTL falls back to a state_resync
// event from the SSE handler (per realtime-sync-deep-dive §7.5).

export interface UpstashEventLogOptions {
  /** Key namespace prefix. Defaults to 'events:'. */
  keyPrefix?: string;
  /** TTL in seconds applied to the stream key on every write. Defaults to 24h. */
  ttlSeconds?: number;
}

export function createUpstashEventLog(
  redis: RedisLike,
  options: UpstashEventLogOptions = {}
): EventLog {
  const prefix = options.keyPrefix ?? 'events:';
  const ttl = options.ttlSeconds ?? 86_400;

  const streamKey = (roomId: string) => `${prefix}${roomId}`;

  return {
    async append(roomId, event) {
      // R-C1: stream id = event.version. Per-recipient log keys (see
      // publish.eventLogKey) guarantee monotonic versions per recipient,
      // so XADD's monotonic-id constraint is satisfied.
      const id = event.version;
      const streamId = `${id}-0`;
      await redis.xadd(streamKey(roomId), streamId, {
        data: JSON.stringify(event),
      });
      // TTL refresh is best-effort and redundant across appends (every event
      // in a burst re-touches the same stream) — don't spend an awaited
      // round-trip on it in the latency-critical publish path. A dropped
      // refresh only matters if EVERY refresh fails for the full 24h TTL.
      void Promise.resolve(redis.expire(streamKey(roomId), ttl)).catch((err) =>
        console.error('[upstashEventLog] expire failed (best-effort):', err)
      );
      return id;
    },

    async range(roomId, fromId) {
      const start = fromId === null ? '-' : `(${fromId}-0`;
      const entries = await redis.xrange(streamKey(roomId), start, '+');
      const result: LoggedEvent[] = [];
      for (const [streamId, fields] of Object.entries(entries)) {
        const dash = streamId.indexOf('-');
        const numeric = parseInt(
          dash >= 0 ? streamId.slice(0, dash) : streamId,
          10
        );
        if (!Number.isFinite(numeric)) continue;
        // Upstash auto-deserializes field values on read, so `fields['data']`
        // is the parsed event object (NOT a JSON string) in production — see
        // decodeStreamValue. Per-entry catch so a single corrupt record can't
        // throw out of the SSE `start` callback and brick the whole stream.
        // (range DROPS a bad entry via `continue`; eventBus.tick logs-and-
        // continues — both contain the throw per-entry, differing only because
        // range builds an array while tick fires side-effects.)
        let event: ServerEvent | null;
        try {
          event = decodeStreamValue<ServerEvent>(fields['data']);
        } catch (err) {
          console.error('[upstashEventLog] skipping undecodable entry', streamId, err);
          continue;
        }
        if (!event) continue;
        result.push({ id: numeric, event });
      }
      return result;
    },
  };
}
