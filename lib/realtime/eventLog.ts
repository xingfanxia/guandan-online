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

import type { ServerEvent } from './messages.js';
import type { RedisLike } from './redisClient.js';

export interface LoggedEvent {
  id: number;
  event: ServerEvent;
}

export interface EventLog {
  /** Append an event; returns the assigned id (sequential per room from 1). */
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
  nextId: number;
}

export function createMemoryEventLog(options: EventLogOptions = {}): EventLog {
  const rooms = new Map<string, RoomLog>();
  const maxPerRoom = options.maxPerRoom;

  function getRoom(roomId: string): RoomLog {
    let room = rooms.get(roomId);
    if (!room) {
      room = { events: [], nextId: 1 };
      rooms.set(roomId, room);
    }
    return room;
  }

  return {
    append(roomId, event) {
      const room = getRoom(roomId);
      const id = room.nextId++;
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
//   - `events:<room>`      Redis Stream — one entry per event
//   - `events:<room>:seq`  monotonic counter (INCR) — assigns the numeric id
//                          surfaced through the LoggedEvent contract
//
// Stream entries are written with explicit ids of the form `<n>-0` so the
// public interface (numeric ids 1, 2, 3...) maps cleanly to stream ids that
// XADD accepts in monotonic order. The event payload is JSON-encoded into a
// single `data` field — keeps schema evolution under JSON's belt, not Redis's.
//
// TTL: both keys are refreshed on every append. Default 24h matches the room
// lifecycle. A reconnecting client that lapses beyond TTL falls back to a
// state_resync event from the SSE handler (per realtime-sync-deep-dive §7.5).

export interface UpstashEventLogOptions {
  /** Key namespace prefix. Defaults to 'events:'. */
  keyPrefix?: string;
  /** TTL in seconds applied to stream + seq keys on every write. Defaults to 24h. */
  ttlSeconds?: number;
}

export function createUpstashEventLog(
  redis: RedisLike,
  options: UpstashEventLogOptions = {}
): EventLog {
  const prefix = options.keyPrefix ?? 'events:';
  const ttl = options.ttlSeconds ?? 86_400;

  const streamKey = (roomId: string) => `${prefix}${roomId}`;
  const seqKey = (roomId: string) => `${prefix}${roomId}:seq`;

  return {
    async append(roomId, event) {
      const id = await redis.incr(seqKey(roomId));
      const streamId = `${id}-0`;
      await redis.xadd(streamKey(roomId), streamId, {
        data: JSON.stringify(event),
      });
      // Best-effort TTL refresh — independent of the write to keep the
      // hot path simple. If a key was just created we still set TTL.
      await redis.expire(streamKey(roomId), ttl);
      await redis.expire(seqKey(roomId), ttl);
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
        const payload = fields['data'];
        if (!payload) continue;
        const event = JSON.parse(payload) as ServerEvent;
        result.push({ id: numeric, event });
      }
      return result;
    },
  };
}
