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

import type { ServerEvent } from './messages';

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
